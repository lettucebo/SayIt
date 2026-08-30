[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$Version,

    [string]$CommitMessageFooter = "",

    [switch]$ResumeTag
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Wait-MainCi {
    param(
        [string]$HeadSha,
        [int]$DiscoveryTimeoutSeconds = 300
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($DiscoveryTimeoutSeconds)
    $run = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        $json = & gh run list --repo lettucebo/SayIt --workflow CI --branch main --event push --limit 20 --json databaseId,headSha,status,conclusion
        if ($LASTEXITCODE -ne 0) {
            throw "gh run list failed"
        }
        $run = @($json | ConvertFrom-Json) |
            Where-Object { $_.headSha -eq $HeadSha } |
            Select-Object -First 1
        if ($run) {
            break
        }
        Start-Sleep -Seconds 5
    }
    if (-not $run) {
        throw "Timed out waiting for the main CI run for commit $HeadSha"
    }

    Write-Host "Waiting for main CI run $($run.databaseId)..."
    & gh run watch $run.databaseId --repo lettucebo/SayIt --exit-status
    if ($LASTEXITCODE -ne 0) {
        throw "Main CI failed for $HeadSha; no release tag was created"
    }
}

function Assert-GitHubCliReady {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI (gh) is required before creating a release commit"
    }
    & gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI is not authenticated for github.com"
    }
}

function Get-TagState {
    param([string]$Tag)

    $localTag = & git tag -l $Tag
    if ($LASTEXITCODE -ne 0) {
        throw "Local tag lookup failed"
    }
    $localSha = $null
    if ($localTag) {
        $localSha = (& git rev-list -n 1 $Tag | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($localSha)) {
            throw "Unable to resolve local tag $Tag"
        }
        $localSha = $localSha.Trim()
    }

    $remoteTagLine = & git ls-remote --exit-code --tags origin "refs/tags/$Tag"
    $remoteTagExit = $LASTEXITCODE
    if ($remoteTagExit -notin @(0, 2)) {
        throw "Remote tag lookup failed with exit code $remoteTagExit"
    }
    return [pscustomobject]@{
        LocalExists = [bool]$localTag
        LocalSha = $localSha
        RemoteExists = $remoteTagExit -eq 0
        RemoteSha = if ($remoteTagExit -eq 0) {
            (($remoteTagLine | Select-Object -First 1) -split '\s+')[0]
        } else {
            $null
        }
    }
}

function Assert-TagAbsent {
    param([string]$Tag)

    $tagState = Get-TagState $Tag
    if ($tagState.LocalExists) {
        throw "Tag $Tag already exists locally"
    }
    if ($tagState.RemoteExists) {
        throw "Tag $Tag already exists on origin"
    }
}

function Get-CargoLockAppVersion {
    param([string]$Text)

    $match = [regex]::Match(
        $Text,
        '(?m)^name = "sayit"\r?\nversion = "([^"]+)"'
    )
    if (-not $match.Success) {
        throw "Cargo.lock sayit package version could not be read"
    }
    return $match.Groups[1].Value
}

function Get-SingleReplacement {
    param(
        [string]$Path,
        [string]$OldValue,
        [string]$NewValue
    )

    $text = [IO.File]::ReadAllText($Path)
    $first = $text.IndexOf($OldValue, [StringComparison]::Ordinal)
    if ($first -lt 0) {
        throw "$Path does not contain the expected version string: $OldValue"
    }
    if ($text.IndexOf($OldValue, $first + $OldValue.Length, [StringComparison]::Ordinal) -ge 0) {
        throw "$Path contains the expected version string more than once"
    }
    return $text.Substring(0, $first) + $NewValue + $text.Substring($first + $OldValue.Length)
}

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw "Version must use X.Y.Z format"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$packagePath = Join-Path $repoRoot "package.json"
$cargoTomlPath = Join-Path $repoRoot "src-tauri\Cargo.toml"
$cargoLockPath = Join-Path $repoRoot "src-tauri\Cargo.lock"
$changelogPath = Join-Path $repoRoot "CHANGELOG.md"

$currentVersion = (Get-Content $tauriConfigPath -Raw | ConvertFrom-Json).version
$currentSemVer = [version]$currentVersion
$targetSemVer = [version]$Version
if ($ResumeTag) {
    if ($targetSemVer -ne $currentSemVer) {
        throw "ResumeTag requires target version $Version to equal current version $currentVersion"
    }
} elseif ($targetSemVer -le $currentSemVer) {
    throw "Target version $Version must be greater than current version $currentVersion"
}

$changelogText = [IO.File]::ReadAllText($changelogPath)
$headerMatch = [regex]::Match(
    $changelogText,
    "(?m)^## \[$([regex]::Escape($Version))\][^\r\n]*\r?\n"
)
if (-not $headerMatch.Success) {
    throw "CHANGELOG.md is missing ## [$Version]"
}
$sectionStart = $headerMatch.Index + $headerMatch.Length
$remainingChangelog = $changelogText.Substring($sectionStart)
$nextVersionHeader = [regex]::Match($remainingChangelog, '(?m)^## \[')
$releaseNotes = if ($nextVersionHeader.Success) {
    $remainingChangelog.Substring(0, $nextVersionHeader.Index)
} else {
    $remainingChangelog
}
if ($releaseNotes -notmatch '(?m)^-[ \t]+\S') {
    throw "CHANGELOG.md section [$Version] contains no release-note bullets"
}

$status = & git status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "git status failed"
}
if ($status) {
    throw "Working tree must be clean before release:`n$($status -join "`n")"
}

$branchOutput = & git branch --show-current
$branch = ($branchOutput | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw "Release must run from a branch, not detached HEAD"
}
if ($branch -ne "main") {
    throw "Release must run from main; current branch is $branch"
}

Assert-GitHubCliReady

$packageOriginal = [IO.File]::ReadAllText($packagePath)
$tauriOriginal = [IO.File]::ReadAllText($tauriConfigPath)
$cargoTomlOriginal = [IO.File]::ReadAllText($cargoTomlPath)
$cargoLockOriginal = [IO.File]::ReadAllText($cargoLockPath)

if ($ResumeTag) {
    $packageVersion = (Get-Content $packagePath -Raw | ConvertFrom-Json).version
    $cargoVersion = if ($cargoTomlOriginal -match '(?m)^version = "([^"]+)"') {
        $Matches[1]
    } else {
        throw "Cargo.toml package version could not be read"
    }
    $cargoLockVersion = Get-CargoLockAppVersion $cargoLockOriginal
    if (@($packageVersion, $currentVersion, $cargoVersion, $cargoLockVersion) |
        Where-Object { $_ -ne $Version }) {
        throw "ResumeTag version synchronization check failed"
    }

    $releaseCommit = (& git rev-parse HEAD).Trim()
    $remoteMainLine = (& git ls-remote origin refs/heads/main | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteMainLine)) {
        throw "Unable to resolve origin/main"
    }
    $remoteMainCommit = ($remoteMainLine -split '\s+')[0]
    if ($remoteMainCommit -ne $releaseCommit) {
        throw "ResumeTag requires HEAD $releaseCommit to match origin/main $remoteMainCommit"
    }

    $tagName = "v$Version"
    $tagState = Get-TagState $tagName
    if ($tagState.LocalExists -and $tagState.LocalSha -ne $releaseCommit) {
        throw "Local tag $tagName points to $($tagState.LocalSha), expected $releaseCommit"
    }
    if ($tagState.RemoteExists) {
        if ($tagState.RemoteSha -ne $releaseCommit) {
            throw "Remote tag $tagName points to $($tagState.RemoteSha), expected $releaseCommit"
        }
        throw "Remote tag $tagName already publishes the validated release commit"
    }

    Write-Host "Resume release tag v$Version for commit $releaseCommit"
    if ($WhatIfPreference) {
        Write-Host "WhatIf: CI/tag resume checks passed; no tag or remote was changed."
        return
    }
    Wait-MainCi -HeadSha $releaseCommit
    if (-not $tagState.LocalExists) {
        Invoke-Git tag $tagName $releaseCommit
    }
    Invoke-Git push origin $tagName
    Write-Host ""
    Write-Host "Released v$Version"
    return
}

Assert-TagAbsent -Tag "v$Version"

$packageOld = "`"version`": `"$currentVersion`","
$packageNew = "`"version`": `"$Version`","
$tauriOld = $packageOld
$tauriNew = $packageNew
$cargoOld = "version = `"$currentVersion`""
$cargoNew = "version = `"$Version`""

$packageNewText = Get-SingleReplacement $packagePath $packageOld $packageNew
$tauriNewText = Get-SingleReplacement $tauriConfigPath $tauriOld $tauriNew
$cargoTomlNewText = Get-SingleReplacement $cargoTomlPath $cargoOld $cargoNew

$newline = if ($cargoLockOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }
$lockOld = "name = `"sayit`"$newline" + "version = `"$currentVersion`""
$lockNew = "name = `"sayit`"$newline" + "version = `"$Version`""
$cargoLockNewText = Get-SingleReplacement $cargoLockPath $lockOld $lockNew

Write-Host "Release $currentVersion -> $Version"
Write-Host "Validated CHANGELOG, clean main branch, absent tag, and four version replacements."

if ($WhatIfPreference) {
    Write-Host "WhatIf: no files, commits, tags, or remotes were changed."
    return
}

$utf8NoBom = [Text.UTF8Encoding]::new($false)
$versionFilesWritten = $true
$commitCreated = $false
$tagCreated = $false
$releaseCommit = ""
try {
    [IO.File]::WriteAllText($packagePath, $packageNewText, $utf8NoBom)
    [IO.File]::WriteAllText($tauriConfigPath, $tauriNewText, $utf8NoBom)
    [IO.File]::WriteAllText($cargoTomlPath, $cargoTomlNewText, $utf8NoBom)
    [IO.File]::WriteAllText($cargoLockPath, $cargoLockNewText, $utf8NoBom)

    $packageVersion = (Get-Content $packagePath -Raw | ConvertFrom-Json).version
    $tauriVersion = (Get-Content $tauriConfigPath -Raw | ConvertFrom-Json).version
    $cargoVersion = if (([IO.File]::ReadAllText($cargoTomlPath)) -match '(?m)^version = "([^"]+)"') {
        $Matches[1]
    } else {
        throw "Cargo.toml package version could not be read"
    }
    $cargoLockVersion = Get-CargoLockAppVersion ([IO.File]::ReadAllText($cargoLockPath))
    if (@($packageVersion, $tauriVersion, $cargoVersion, $cargoLockVersion) |
        Where-Object { $_ -ne $Version }) {
        throw "Version synchronization check failed"
    }

    & cargo metadata --manifest-path $cargoTomlPath --locked --format-version 1 *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "cargo metadata --locked failed"
    }

    Invoke-Git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
    $commitArgs = @("commit", "-m", "chore: bump version to $Version")
    if (-not [string]::IsNullOrWhiteSpace($CommitMessageFooter)) {
        $commitArgs += @("-m", $CommitMessageFooter)
    }
    Invoke-Git @commitArgs
    $commitCreated = $true
    $releaseCommit = (& git rev-parse HEAD).Trim()
    Invoke-Git push origin $branch
    Wait-MainCi -HeadSha $releaseCommit
    Invoke-Git tag "v$Version" $releaseCommit
    $tagCreated = $true
    Invoke-Git push origin "v$Version"
} catch {
    if ($versionFilesWritten -and -not $commitCreated) {
        [IO.File]::WriteAllText($packagePath, $packageOriginal, $utf8NoBom)
        [IO.File]::WriteAllText($tauriConfigPath, $tauriOriginal, $utf8NoBom)
        [IO.File]::WriteAllText($cargoTomlPath, $cargoTomlOriginal, $utf8NoBom)
        [IO.File]::WriteAllText($cargoLockPath, $cargoLockOriginal, $utf8NoBom)
        & git restore --staged package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock 2>$null
    }
    if ($commitCreated -and -not $tagCreated) {
        Write-Warning "Release commit $releaseCommit is on main, but no tag was created. Fix or rerun CI, then execute: .\scripts\release.ps1 $Version -ResumeTag"
    } elseif ($tagCreated) {
        Write-Warning "Local tag v$Version exists at $releaseCommit. Verify origin before retrying the tag push."
    }
    Write-Error $_
    throw
}

Write-Host ""
Write-Host "Released v$Version"
Write-Host "Release workflow: https://github.com/lettucebo/SayIt/actions/workflows/release.yml"
