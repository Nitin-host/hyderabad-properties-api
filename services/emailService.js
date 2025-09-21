const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false // Accept self-signed certificates
    }
  });
};

// Send confirmation email for user registration
exports.sendConfirmationEmail = async (email, name) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Welcome to Hyderabad Properties - Registration Confirmation',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Hyderabad Properties</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #2c3e50;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f8f9fa;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .button {
              display: inline-block;
              background-color: #3498db;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Welcome to Hyderabad Properties!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Thank you for registering with Hyderabad Properties! We're excited to have you join our community of property enthusiasts.</p>
            
            <p>Your account has been successfully created and you can now:</p>
            <ul>
              <li>Browse premium properties in Hyderabad</li>
              <li>Save your favorite listings</li>
              <li>Get personalized property recommendations</li>
              <li>Connect with verified brokers</li>
            </ul>
            
            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
            
            <p>Best regards,<br>
            The Hyderabad Properties Team</p>
          </div>
          <div class="footer">
            <p>© 2024 Hyderabad Properties. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </body>
        </html>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Confirmation email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    throw error;
  }
};

// Send official credentials email when super_admin creates a user
exports.sendOfficialCredentialsEmail = async (email, name, tempPassword, role) => {
  try {
    const transporter = createTransporter();

    const roleDescriptions = {
      admin: 'Administrator - You have access to manage properties and users',
      user: 'User - You can browse and manage your property listings',
      super_admin: 'Super Administrator - You have full system access'
    };

    const mailOptions = {
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Your Hyderabad Properties Account - Login Credentials',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Account Credentials</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #2c3e50;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f8f9fa;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .credentials {
              background-color: #e8f4f8;
              border: 1px solid #bee5eb;
              border-radius: 5px;
              padding: 20px;
              margin: 20px 0;
            }
            .credential-item {
              margin: 10px 0;
              font-weight: bold;
            }
            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffeaa7;
              border-radius: 5px;
              padding: 15px;
              margin: 20px 0;
              color: #856404;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Hyderabad Properties</h1>
            <h2>Account Created Successfully</h2>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>An account has been created for you on the Hyderabad Properties platform by our administrator.</p>
            
            <div class="credentials">
              <h3>Your Login Credentials:</h3>
              <div class="credential-item">Email: ${email}</div>
              <div class="credential-item">Temporary Password: ${tempPassword}</div>
              <div class="credential-item">Role: ${role.charAt(0).toUpperCase() + role.slice(1)}</div>
            </div>
            
            <p><strong>Role Description:</strong><br>
            ${roleDescriptions[role] || 'Standard user access'}</p>
            
            <div class="warning">
              <strong>Important Security Notice:</strong>
              <ul>
                <li>Please change your password immediately after your first login</li>
                <li>Do not share your credentials with anyone</li>
                <li>Keep your login information secure</li>
              </ul>
            </div>
            
            <p>To access your account:</p>
            <ol>
              <li>Visit the Hyderabad Properties login page</li>
              <li>Use the email and temporary password provided above</li>
              <li>Change your password in your profile settings</li>
            </ol>
            
            <p>If you have any questions or need assistance, please contact our support team.</p>
            
            <p>Best regards,<br>
            The Hyderabad Properties Team</p>
          </div>
          <div class="footer">
            <p>© 2024 Hyderabad Properties. All rights reserved.</p>
            <p>This email contains sensitive information. Please handle it securely.</p>
          </div>
        </body>
        </html>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Official credentials email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending official credentials email:', error);
    throw error;
  }
};

// Send password reset email
exports.sendPasswordResetEmail = async (email, name, resetToken) => {
  try {
    const transporter = createTransporter();
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

    const mailOptions = {
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Password Reset Request - Hyderabad Properties',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset Request</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #e74c3c;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f8f9fa;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .button {
              display: inline-block;
              background-color: #e74c3c;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
            }
            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffeaa7;
              border-radius: 5px;
              padding: 15px;
              margin: 20px 0;
              color: #856404;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              font-size: 12px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>We received a request to reset your password for your Hyderabad Properties account.</p>
            
            <p>Click the button below to reset your password:</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all;">${resetUrl}</p>
            
            <div class="warning">
              <strong>Security Notice:</strong>
              <ul>
                <li>This link will expire in 10 minutes</li>
                <li>If you didn't request this reset, please ignore this email</li>
                <li>Your password will remain unchanged until you create a new one</li>
              </ul>
            </div>
            
            <p>If you have any questions, please contact our support team.</p>
            
            <p>Best regards,<br>
            The Hyderabad Properties Team</p>
          </div>
          <div class="footer">
            <p>© 2024 Hyderabad Properties. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </body>
        </html>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};

// Test email configuration
exports.testEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email configuration is valid');
    return true;
  } catch (error) {
    console.error('Email configuration error:', error);
    return false;
  }
};