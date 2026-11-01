# 3R Tools sign-in emails

These are the emails Supabase sends for 3R Tools sign-ins: an invite, a password reset, and so on. They carry the 3R logo, colors and address. The logo images are served from this site (`/email/`).

## Put them in Supabase

Go to the Supabase dashboard for the 3r-tools project, then **Authentication → Emails → Templates**. For each email type below, paste the subject, then switch the body to source view and paste the whole HTML file. Press **Save**.

| Email type in Supabase | Subject | File |
|---|---|---|
| Invite user | You're invited to 3R Tools | `invite.html` |
| Reset password | Reset your 3R Tools password | `reset-password.html` |
| Magic link | Your 3R Tools sign-in link | `magic-link.html` |
| Confirm signup | Confirm your email for 3R Tools | `confirm-signup.html` |
| Change email address | Confirm your new email for 3R Tools | `change-email.html` |

Keep the `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` parts exactly as they are. Supabase fills them in.

## Before they work well

1. **Site URL.** Authentication → URL Configuration → Site URL must be `https://ross680.github.io/3r-tools/`. Otherwise the button opens `localhost:3000`.
2. **Redirect URLs.** Add `https://ross680.github.io/3r-tools/` and `https://ross680.github.io/3r-tools/inventory/`.
3. **Sender.** To send from a 3R address instead of Supabase's, set up custom SMTP (Brevo works) under Authentication → Emails → SMTP Settings. Supabase's own sender is also limited to a few emails an hour.

## Test

Press **Forgot password** on the 3R Tools sign-in screen to get the reset email. To see the invite, invite a second address of yours from the Supabase dashboard (Authentication → Users → Invite user). Check the email on a phone and in Outlook if anyone uses it.
