require('dotenv').config();
// const SibApiV3Sdk = require('@sendinblue/client');

// const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
// tranEmailApi.setApiKey(
//   SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
//   process.env.BREVO_API_KEY
// );

// const sendEmail = async (to, subject, html) => {
//   try {
//     const response = await tranEmailApi.sendTransacEmail({
//       sender: {
//         email: process.env.EMAIL_FROM,
//         name: process.env.EMAIL_FROM_NAME,
//       },
//       to: [{ email: to }],
//       subject,
//       htmlContent: html,
//     });
//     console.log(`Email sent successfully`);
//     return response;
//   } catch (error) {
//     console.error(`Error sending email to ${to}:`, error);
//     throw error;
//   }
// };
const nodemailer = require("nodemailer");

// Create a transporter using your SMTP configuration
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // e.g., smtp.gmail.com or your SMTP server
  port: process.env.EMAIL_PORT || 587,
  secure: false, // true for 465 (SSL), false for other ports
  auth: {
    user: process.env.EMAIL_USER, // SMTP username
    pass: process.env.EMAIL_PASS, // SMTP password or app-specific password
  },
  tls: {
    rejectUnauthorized: false, // <== Add this line
  },
});

// Generic sendEmail function
const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });
    console.log("Email sent Successfully");
    return info;
  } catch (error) {
    console.error(`Error sending email to ${to}:`, error);
    throw error;
  }
};


// Send confirmation email for user registration
exports.sendConfirmationEmail = async (email, name) => {
  return await sendEmail(
    email,
    "Welcome to RR Properties - Registration Confirmation",
    `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to RR Properties</title>
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
            <h1>Welcome to RR Properties!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Thank you for registering with RR Properties! We're excited to have you join our community of property enthusiasts.</p>
            
            <p>Your account has been successfully created and you can now:</p>
            <ul>
              <li>Browse premium properties in Hyderabad</li>
              <li>Save your favorite listings</li>
              <li>Get personalized property recommendations</li>
              <li>Connect with verified brokers</li>
            </ul>
            
            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
            
            <p>Best regards,<br>
            The RR Properties Team</p>
          </div>
          <div class="footer">
            <p>© 2025 RR Properties. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </body>
        </html>
      `
  );
};

// Send new user registration details to super admin
exports.sendNewUserDetailsToSuperAdmin = async (user) => {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail) {
    console.error("SUPER_ADMIN_EMAIL not configured in .env");
    return;
  }
  return await sendEmail(
    superAdminEmail,
    "New User Registered - RR Properties",
    `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New User Registered</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f8f9fa;
            }
            .header {
              background-color: #2c3e50;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            table th, table td {
              padding: 12px 15px;
              border: 1px solid #ddd;
              text-align: left;
            }
            table th {
              background-color: #f4f6f8;
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
            <h1>New User Registration Alert</h1>
          </div>
          <div class="content">
            <h2>A new user has registered on RR Properties:</h2>
            
            <table>
              <tr>
                <th>Name</th>
                <td>${user.name}</td>
              </tr>
              <tr>
                <th>Email</th>
                <td>${user.email}</td>
              </tr>
              <tr>
                <th>Phone</th>
                <td>${user.phone || "N/A"}</td>
              </tr>
              <tr>
                <th>Role</th>
                <td>${user.role}</td>
              </tr>
              <tr>
                <th>Registered At</th>
                <td>${new Date().toLocaleString()}</td>
              </tr>
            </table>

            <p>Please review this user in the admin dashboard if required.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} RR Properties. All rights reserved.</p>
          </div>
        </body>
        </html>
      `
  );
};

// Send official credentials email when super_admin creates a user
exports.sendOfficialCredentialsEmail = async (email, name, tempPassword, role) => {
  const roleDescriptions = {
    admin: "Administrator - You have access to manage properties and users",
    user: "User - You can browse and manage your property listings",
    super_admin: "Super Administrator - You have full system access",
  };

  const loginUrl = `${process.env.CLIENT_URL}`;

  return await sendEmail(
    email,
    "Your RR Properties Account - Login Credentials",
    `<!DOCTYPE html>
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
            .button {
              display: inline-block;
              background-color: #2c3e50;
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
            <h1>RR Properties</h1>
            <h2>Account Created Successfully</h2>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>An account has been created for you on the RR Properties platform by our administrator.</p>
            
            <div class="credentials">
              <h3>Your Login Credentials:</h3>
              <div class="credential-item">Email: ${email}</div>
              <div class="credential-item">Temporary Password: ${tempPassword}</div>
              <div class="credential-item">Role: ${
                role.charAt(0).toUpperCase() + role.slice(1)
              }</div>
            </div>
            
            <p><strong>Role Description:</strong><br>
            ${roleDescriptions[role] || "Standard user access"}</p>
            
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
              <li>Click the button below to visit the login page</li>
              <li>Use the email and temporary password provided above</li>
              <li>Change your password in your profile settings</li>
            </ol>
            
            <a href="${loginUrl}" class="button">Login to RR Properties</a>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all;">${loginUrl}</p>
            
            <p>If you have any questions or need assistance, please contact our support team.</p>
            
            <p>Best regards,<br>
            The RR Properties Team</p>
          </div>
          <div class="footer">
            <p>© 2025 RR Properties. All rights reserved.</p>
            <p>This email contains sensitive information. Please handle it securely.</p>
          </div>
        </body>
        </html>
      `
  );
};

// Send password reset email
exports.sendPasswordResetEmail = async (email, name, resetToken) => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
  return await sendEmail(
    email,
    "Password Reset Request - RR Properties",
    `<!DOCTYPE html>
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
            <p>We received a request to reset your password for your RR Properties account.</p>
            
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
            The RR Properties Team</p>
          </div>
          <div class="footer">
            <p>© 2025 RR Properties. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </body>
        </html>
      `
  );
};

// Send OTP email
exports.sendOtpEmail = async (email, name, otp) => {
  return await sendEmail(
    email,
    "Your RR Properties Login OTP",
    `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your OTP Code</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f8f9fa;
            }
            .header {
              background-color: #2c3e50;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 5px 5px;
              text-align: center;
            }
            .otp {
              display: inline-block;
              background-color: #3498db;
              color: white;
              font-size: 24px;
              font-weight: bold;
              padding: 15px 30px;
              border-radius: 8px;
              margin: 20px 0;
              letter-spacing: 5px;
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
            <h1>RR Properties Login Verification</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Please use the following OTP to complete your login:</p>
            
            <div class="otp">${otp}</div>
            
            <p>This OTP is valid for <strong>10 minutes</strong>. 
            Do not share it with anyone.</p>
            
            <p>If you didn’t request this login, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} RR Properties. All rights reserved.</p>
          </div>
        </body>
        </html>
      `
  );
};

// Send forgot password OTP email
exports.sendForgotPasswordOtpEmail = async (email, name, otp) => {
  return await sendEmail(
    email,
    "Reset Your RR Properties Account Password",
    `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f6f8;
          }
          .header {
            background-color: #c0392b; /* Red tone for alert/reset */
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 5px 5px 0 0;
          }
          .content {
            background-color: white;
            padding: 30px;
            border-radius: 0 0 5px 5px;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
          }
          .otp {
            display: inline-block;
            background-color: #3498db;
            color: white;
            font-size: 24px;
            font-weight: bold;
            padding: 15px 30px;
            border-radius: 8px;
            margin: 20px 0;
            letter-spacing: 5px;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
            color: #666;
          }
          p {
            margin: 10px 0;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>RR Properties - Password Reset</h1>
        </div>
        <div class="content">
          <h2>Hello ${name},</h2>
          <p>We received a request to reset your password for your <strong>RR Properties</strong> account.</p>
          
          <p>Use the OTP below to proceed with resetting your password:</p>
          <div class="otp">${otp}</div>

          <p>This OTP is valid for <strong>10 minutes</strong>. Please do not share it with anyone.</p>

          <p>If you did not request a password reset, you can safely ignore this email — your account is still secure.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} RR Properties. All rights reserved.</p>
        </div>
      </body>
      </html>`
  );
};
