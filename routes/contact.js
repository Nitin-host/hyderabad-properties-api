// backend/routes/contact.js
const express = require('express');
const router = express.Router();
const SibApiV3Sdk = require('@sendinblue/client');

const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
tranEmailApi.setApiKey(
  SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

// Generic send email helper
const sendEmail = async (to, subject, html) => {
  try {
    const response = await tranEmailApi.sendTransacEmail({
      sender: {
        email: process.env.EMAIL_FROM,
        name: process.env.EMAIL_FROM_NAME,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    });
    console.log(`✅ Email sent successfully to ${to}:`, response.messageId || response);
    return response;
  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    throw error;
  }
};

// Send confirmation email to user
const sendUserEmail = async (email, name) => {
  return await sendEmail(
    email,
    'Thank you for contacting Hyderabad Properties',
    `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Thank You!</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height:1.6; color:#333;">
        <h2>Hello ${name},</h2>
        <p>Thank you for contacting Hyderabad Properties. Our team will reach out to you shortly regarding your inquiry.</p>
        <p>Best regards,<br>The Hyderabad Properties Team</p>
      </body>
      </html>
    `
  );
};

// Send notification email to super_admin
const sendAdminEmail = async ({ name, email, phone, propertyType }) => {
  return await sendEmail(
    process.env.SUPER_ADMIN_EMAIL,
    'New Contact Form Submission',
    `
      <h2>New Contact Request</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Property Type:</strong> ${propertyType}</p>
    `
  );
};

// Contact form API
router.post('/contact', async (req, res) => {
  try {
    const { name, email, phone, propertyType } = req.body;

    if (!name || !email || !phone || !propertyType) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Send emails
    await sendUserEmail(email, name);
    await sendAdminEmail({ name, email, phone, propertyType });

    res.status(200).json({ message: 'Contact request submitted successfully' });
  } catch (error) {
    console.error('Error sending emails:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;