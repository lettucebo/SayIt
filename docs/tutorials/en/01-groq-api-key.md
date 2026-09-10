Applications need an API key to call Groq APIs on behalf of your account. An API key is a private credential, not programming code, and you do not need to write code to obtain one.

One Groq API key can authorize different Groq APIs, including:

1. Speech transcription, which converts audio into text.
2. Language models, which process or generate text.

You do not need separate keys for transcription and language-model requests.

## Before you begin

You will need:

- A web browser
- An account you can use to sign in to Groq

Groq's official plans page confirms that a **Free** plan is available for getting started with its APIs. You can create a Free plan account without adding a credit card. Plan details can change, so review the current options shown in GroqCloud before proceeding.

## Sign in to GroqCloud

Open the [GroqCloud Console](https://console.groq.com/) in your browser.

The public sign-in screen directly offers Google, GitHub, SSO, and email. Choose whichever option fits the account you want to use. For most personal users, Google, GitHub, or email will be the simplest choice. SSO is usually a company or school sign-in.

![GroqCloud sign-in options for Google, GitHub, SSO, and email](./images/groq-sign-in.png)

Complete the prompts in your browser. If Groq asks you to choose or create an organization or project, think of it as the workspace that will hold your key and usage. Follow the current on-screen instructions. Groq may update the wording and layout over time, so use the labels shown in your account rather than looking for an exact screen from an older tutorial.

If you want to confirm the plan attached to your account, open the [Billing Plans](https://console.groq.com/settings/billing/plans) page while signed in. Groq describes the Free plan as suitable for building and testing with its APIs.

## Create an API key

Once you are signed in:

1. Open **API Keys** in the GroqCloud Console, or go directly to [console.groq.com/keys](https://console.groq.com/keys).
2. Look for the control to create a new key and select it.
3. Complete the prompts Groq displays for your account or project.
4. Copy the generated key immediately and save it in a password manager.

The interface may change, so follow the labels, fields, and instructions currently shown in the GroqCloud Console.

The complete API key is displayed only once, when it is created. Copy it before closing the dialog; you will not be able to return later and reveal the full value again. Treat it like a password. Do not paste it into a public message, support post, screenshot, shared document, or public GitHub project.

## Understand the Free plan limits

The Free plan is useful for getting started, but it is still subject to usage limits. Groq counts requests, the amount of text processed (tokens), and audio duration. Everyone in the same Groq workspace shares those limits.

![GroqCloud rate limits page with request, token, and audio limit categories](./images/groq-rate-limits.png)

You do not need to memorize the abbreviations on the Limits page. They mean:

| Type | Meaning |
| --- | --- |
| RPM / RPD | Requests per minute / requests per day |
| TPM / TPD | Tokens per minute / tokens per day |
| ASH / ASD | Audio seconds per hour / audio seconds per day |

Do not rely on quota numbers copied from a blog post. Groq can revise limits, and different models may have different allowances. Use these official pages instead:

- [Rate Limits documentation](https://console.groq.com/docs/rate-limits) explains the types of limits and how they work.
- The signed-in [Limits page](https://console.groq.com/settings/limits) shows the current, exact limits for your organization.

If a request exceeds a limit, the Groq API can return `429 Too Many Requests`. That does not necessarily mean the key is invalid. Wait before trying again, check the Limits page, and make sure another app or teammate in the same Groq organization is not using the shared allowance.

## Keep your key private

Groq's official security guidance says API keys should never be exposed or hardcoded in source code. The practical rules are straightforward:

- Never publish the key in GitHub or another public code project.
- Do not include it in screenshots, chat messages, issue reports, or documents.
- Do not paste it into websites or apps you do not trust.
- Avoid storing it in an unprotected plain-text note.
- Save a newly created key immediately because its complete value is shown only once.
- Revoke keys you no longer use.

If you accidentally expose the key, assume someone else may have copied it. Open the [API Keys page](https://console.groq.com/keys), revoke the exposed key immediately, and create a replacement. Groq also recommends reviewing logs for suspicious activity and never reusing a compromised key, even temporarily.

## Wrap-up

The process is short: sign in to GroqCloud, open API Keys, follow the current controls, and save the new key in a password manager. One Groq credential can authorize speech transcription and language-model APIs.

Keep the key private, check Groq's live Limits page instead of relying on fixed quota numbers, and replace the key immediately if it is ever exposed.

The next article explains how to configure this key in [SayIt](./02-sayit-setup.md).

---

**References:**

- [GroqCloud Console](https://console.groq.com/)
- [Groq API Keys](https://console.groq.com/keys)
- [Groq Billing Plans](https://console.groq.com/settings/billing/plans)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Groq account Limits](https://console.groq.com/settings/limits)
- [Groq Security Onboarding](https://console.groq.com/docs/production-readiness/security-onboarding)
