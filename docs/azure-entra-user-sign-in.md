# 使用 Microsoft 帳號登入 Azure OpenAI / Foundry

SayIt 支援用**你自己的公司帳號**登入 Azure OpenAI / Microsoft Foundry，
不需要 client secret。適合公司政策禁用長期共享密鑰的環境。

## 為什麼用這個模式

| | API Key | 服務主體（client secret） | **Microsoft 帳號登入** |
|---|---|---|---|
| 需要長期密鑰 | ✅ 要 | ✅ 要 | ❌ 不用 |
| 身分 | 資源層級 | 全公司共用一個 | **每個人自己的帳號** |
| 稽核 | 看不出是誰 | 看不出是誰 | 可追溯到個人 |
| MFA / Conditional Access | 不適用 | 不適用 | 自動套用 |
| 離職後 | 需手動撤銷 | 需手動撤銷 | 自動失效 |

登入一次後，只要在有效期內持續使用就不需要再登入
（Entra 的 refresh token 為 90 天滑動視窗；實際期限仍受公司政策影響）。

---

## 系統管理員：一次性設定

以下步驟通常由 IT 完成一次，之後所有使用者共用同一組 Tenant ID / Client ID。

### 1. 建立 App Registration

Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**

| 欄位 | 值 |
|---|---|
| Name | 例如 `SayIt Desktop` |
| Supported account types | **Accounts in this organizational directory only** |
| Redirect URI | 平台選 **Mobile and desktop applications**，值填 `http://localhost` |

> ⚠️ **Redirect URI 不可帶路徑**。`http://localhost/callback` 會被拒（AADSTS50011）。
> port 在比對時會被忽略，所以 `http://localhost` 一筆即可涵蓋 SayIt 動態使用的 port。
> 建議另外加一筆 `http://127.0.0.1`（SayIt 實際使用這個位址，以避免 IPv6 解析問題）。
> `http://127.0.0.1` 無法從 Portal 的輸入框新增，需改用 CLI 或編輯 manifest 的
> `replyUrlsWithType`。

### 2. 啟用 public client flows

同一個 App Registration → **Authentication** → 最下方 **Advanced settings**
→ **Allow public client flows** 設為 **Yes**。

沒開這個，登入會失敗。

### 3. 加入 API permission

**API permissions** → **Add a permission** → **APIs my organization uses**
→ 搜尋 **Azure Cognitive Services** → **Delegated permissions** → 勾選 `user_impersonation`。

若你的資源走 Foundry 的 v1 路徑（`/openai/v1/`），再加一筆：
搜尋 **Azure Machine Learning Services** → **Delegated permissions** → `user_impersonation`。

> 這兩個權限的 consent type 都是 **User**，一般情況下使用者第一次登入時
> 自己同意即可，不需要管理員授權。但若貴公司關閉了「使用者同意」政策，
> 仍需管理員按 **Grant admin consent**。

### 4. 指派 Azure RBAC 角色

**這一步最容易漏掉。** App Registration 的權限只讓 SayIt 能「代表使用者要求 token」，
真正能不能呼叫 API 由 Azure RBAC 決定。

前往你的 **Azure OpenAI / AI Services 資源** → **Access control (IAM)**
→ **Add role assignment** → 角色選 **Cognitive Services OpenAI User**
→ 指派給使用者，或（建議）指派給一個 Entra 群組再把使用者加進去。

> 變更後最多需要 5 分鐘生效。

### 5. 確認資源啟用 custom subdomain

Entra 驗證要求資源使用 custom subdomain（例如
`https://my-resource.openai.azure.com`，而非 regional endpoint）。
新建的資源預設就有；舊資源可在資源的 **Networking** 頁確認。

### 6. 把設定值交給使用者

使用者需要：

- **Tenant ID**（Entra ID 概觀頁的 Directory (tenant) ID）
- **Client ID**（App Registration 概觀頁的 Application (client) ID）
- **Endpoint URL**（資源的端點，例如 `https://my-resource.openai.azure.com`）
- **部署名稱**（chat 與 Whisper 各一個）

**不需要**交付任何密鑰。

### 用 CLI 一次完成（選用）

```bash
# 建立 public client（無 secret）
APP_ID=$(az ad app create \
  --display-name "SayIt Desktop" \
  --sign-in-audience AzureADMyOrg \
  --public-client-redirect-uris "http://localhost" "http://127.0.0.1" \
  --is-fallback-public-client true \
  --query appId -o tsv)

az ad sp create --id "$APP_ID"

# 加入 delegated permission（Portal 的 --required-resource-accesses 在部分
# az 版本會被靜默忽略，因此用 Graph PATCH 並回讀確認）
OBJ_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)
cat > /tmp/rra.json <<'JSON'
{"requiredResourceAccess":[
 {"resourceAppId":"7d312290-28c8-473c-a0ed-8e53749b6d6d",
  "resourceAccess":[{"id":"5f1e8914-a52b-429f-9324-91b92b81adaf","type":"Scope"}]},
 {"resourceAppId":"18a66f5f-dbdf-4c17-9dd7-1634712a9cbe",
  "resourceAccess":[{"id":"1a7925b5-f871-417a-9b8b-303f9f29fa10","type":"Scope"}]}
]}
JSON
az rest --method patch \
  --url "https://graph.microsoft.com/v1.0/applications/$OBJ_ID" \
  --headers "Content-Type=application/json" --body @/tmp/rra.json
az ad app show --id "$APP_ID" --query requiredResourceAccess

# 指派 RBAC（建議改用群組 objectId）
az role assignment create \
  --assignee "user@contoso.com" \
  --role "Cognitive Services OpenAI User" \
  --scope "/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.CognitiveServices/accounts/<NAME>"

echo "Tenant ID: $(az account show --query tenantId -o tsv)"
echo "Client ID: $APP_ID"
```

---

## 使用者：登入步驟

1. 開啟 SayIt → **設定** → 找到 **Azure / Microsoft Foundry** 卡片並啟用
2. 填入 **Endpoint URL**
3. 驗證方式選 **Microsoft 帳號登入**
4. 填入 IT 給的 **Tenant ID** 與 **Client ID**
5. 點 **使用 Microsoft 帳號登入** → 系統瀏覽器會開啟
6. 完成登入；首次會出現同意畫面，按「接受」
7. 回到 SayIt，卡片會顯示「已登入：你的帳號」
8. 往下填入 **Chat 部署名稱** 與 **Whisper 部署名稱**，各按「測試連線」確認

---

## 疑難排解

| 症狀 | 原因與處理 |
|---|---|
| 瀏覽器顯示 **AADSTS50011**（reply URL 不符） | App Registration 的 redirect URI 沒設或帶了路徑。改成 `http://localhost`（不含路徑） |
| 瀏覽器顯示 **AADSTS7000218** 或要求 client secret | 沒開 **Allow public client flows** |
| 顯示「登入被貴公司的存取政策擋下」 | Conditional Access 擋下。把訊息中的 AADSTS 代碼提供給 IT |
| 登入成功但轉錄回 **401 / 403** | 缺 Azure RBAC。確認在**資源**上有 `Cognitive Services OpenAI User`（不是只有 App Registration 權限），並等 5 分鐘 |
| 登入成功但回 **404** | 部署名稱打錯，或 endpoint 指向錯的資源 |
| 一直停在「已開啟瀏覽器，請完成登入…」 | 防毒/防火牆可能擋掉本機 loopback 連線。放行 SayIt 對 `127.0.0.1` 的本機連線後重試；或按取消再試一次 |
| 更新 SayIt 後要求重新登入 | macOS 未簽章版本的已知限制，重新登入即可 |
| 換了電腦後顯示未登入 | 正常。refresh token 存在 OS 憑證庫，**不會**包含在設定備份裡，需重新登入 |

### 憑證存在哪裡

| 平台 | 位置 |
|---|---|
| Windows | 認證管理員 → Windows 認證，服務名稱 `com.sayit.app` |
| macOS | 鑰匙圈存取 → 登入，搜尋 `com.sayit.app` |

登出或「清除連線」會一併刪除。設定備份**不含** refresh token。

---

## 安全性說明

- SayIt **不持有任何長期密鑰**；只保存 refresh token，且存在 OS 原生憑證庫，不是明文設定檔
- access token 只存在記憶體，不寫入磁碟
- 授權流程使用 PKCE（S256），授權碼只回到本機 `127.0.0.1` 的臨時 listener
- 呼叫的 scope 由程式固定（`cognitiveservices.azure.com` / `ai.azure.com`），
  介面無法要求其他權限（例如讀信件）
- 端點限制在 `*.openai.azure.com`、`*.services.ai.azure.com`、`*.cognitiveservices.azure.com`

## 已知限制

- 只支援 Azure 公有雲；不支援 Azure Government / China
- macOS 版本未經 Apple 簽章，App 更新後可能需要重新登入
