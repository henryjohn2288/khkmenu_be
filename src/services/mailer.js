const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM || 'no-reply@example.com';

const resend = apiKey ? new Resend(apiKey) : null;

async function sendInviteEmail({ to, inviteUrl, storeName, role }) {
  if (!resend) {
    console.log(`[Mailer disabled] Invite for ${to}: ${inviteUrl}`);
    return;
  }

  const subject = `You're invited to manage ${storeName}`;
  const html = `
    <p>Hello,</p>
    <p>You have been invited as <strong>${role}</strong> to the store <strong>${storeName}</strong>.</p>
    <p><a href="${inviteUrl}">Click here to accept the invite</a></p>
    <p>If the button doesn't work, copy and paste this link:<br/>${inviteUrl}</p>
    <p>Thanks,<br/>Digital Menu</p>
  `;

  await resend.emails.send({
    from: mailFrom,
    to,
    subject,
    html
  });
}

module.exports = {
  sendInviteEmail
};
