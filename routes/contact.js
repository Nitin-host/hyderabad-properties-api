// backend/routes/contact.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com",
    port: Number(process.env.BREVO_SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false, // Accept self-signed certs
    },
  });
};

// Send confirmation email to user
const sendUserEmail = async (email, name) => {
  const transporter = await createTransporter();

  const mailOptions = {
    from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: 'Thank you for contacting Hyderabad Properties',
    html: `
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
    `,
  };

  await transporter.sendMail(mailOptions);
};

// Send notification email to super_admin
const sendAdminEmail = async ({ name, email, phone, propertyType }) => {
  const transporter = await createTransporter();

  const mailOptions = {
    from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
    to: process.env.SUPER_ADMIN_EMAIL, // e.g., superadmin@example.com
    subject: 'New Contact Form Submission',
    html: `
      <h2>New Contact Request</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Property Type:</strong> ${propertyType}</p>
    `,
  };

  await transporter.sendMail(mailOptions);
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
