import nodemailer from 'nodemailer'
import crypto from 'crypto'

const createTransporter = () => {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !port || !user || !pass) {
    throw new Error('As credenciais SMTP não estão configuradas. Defina SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS nas variáveis de ambiente.')
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass
    }
  })
}

export function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex')
}

export const verifyEmailConfig = async () => {
  try {
    const transporter = createTransporter()
    const verification = await transporter.verify()
    console.log('La configuration email est valide :', verification)
    return true
  } catch (error) {
    console.error('Erro na configuração de e-mail:', error)
    return false
  }
}

export async function sendVerificationEmail(email, token) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://rebornmmo.com'
    const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER

    const transporter = createTransporter()
    const verificationLink = `${baseUrl}/verify-email?token=${token}`

    const mailOptions = {
      from: mailFrom,
      to: email,
      subject: 'Verifique sua conta ReactioN MMO',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verifique sua conta ReactioN MMO</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="min-width: 100%; background-color: #f4f4f4;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td align="center" style="padding: 40px 0; background-color: #1a1a1a;">
                      <img src="${baseUrl}/logo-reaction.webp" alt="Logo ReactioN MMO" style="width: 200px; height: auto;">
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 40px;">
                      <h1 style="margin: 0 0 20px; color: #eab308; text-align: center; font-size: 24px;">
                        Bem-vindo ao ReactioN MMO!
                      </h1>

                      <p style="margin: 0 0 20px; color: #333; font-size: 16px; line-height: 1.5; text-align: center;">
                        Obrigado pelo cadastro! Para começar sua aventura, confirme seu e-mail clicando no botão abaixo:
                      </p>

                      <table role="presentation" style="width: 100%; margin: 30px 0;">
                        <tr>
                          <td align="center">
                            <a href="${verificationLink}"
                               style="display: inline-block; padding: 14px 30px; background-color: #eab308; color: #000000; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
                              Verificar e-mail
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin: 20px 0 0; color: #666; font-size: 14px; text-align: center;">
                        Este link de verificação expira em 24 horas.
                      </p>

                      <p style="margin: 20px 0; color: #666; font-size: 14px; text-align: center;">
                        Se o botão não funcionar, copie e cole este link no seu navegador:
                        <br>
                        <a href="${verificationLink}" style="color: #0066cc; text-decoration: none; word-break: break-all;">
                          ${verificationLink}
                        </a>
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 20px; background-color: #1a1a1a; color: #ffffff; text-align: center;">
                      <p style="margin: 0; font-size: 14px;">
                        © ${new Date().getFullYear()} ReactioN MMO. Todos os direitos reservados.
                      </p>
                      <p style="margin: 10px 0 0; font-size: 12px; color: #999;">
                        Se você não criou uma conta no ReactioN MMO, ignore este e-mail.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    }

    await transporter.verify()
    const info = await transporter.sendMail(mailOptions)
    console.log('Email de verification envoye :', info.messageId)
    return true
  } catch (error) {
    console.error('Erro ao enviar o e-mail de verificação:', {
      message: error.message,
      code: error.code,
      command: error.command
    })
    return false
  }
}

export async function sendTemporaryPasswordEmail(email, tempPassword) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://rebornmmo.com'
    const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER

    const transporter = createTransporter()
    const loginLink = `${baseUrl}/login`

    const mailOptions = {
      from: mailFrom,
      to: email,
      subject: 'Sua senha temporária do ReactioN MMO',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sua senha temporária</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="min-width: 100%; background-color: #f4f4f4;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td align="center" style="padding: 40px 0; background-color: #1a1a1a;">
                      <img src="${baseUrl}/logo-reaction.webp" alt="Logo ReactioN MMO" style="width: 200px; height: auto;">
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 40px;">
                      <h1 style="margin: 0 0 20px; color: #eab308; text-align: center; font-size: 24px;">
                        Redefinição de senha
                      </h1>

                      <p style="margin: 0 0 20px; color: #333; font-size: 16px; line-height: 1.5; text-align: center;">
                        Você pediu para redefinir sua senha. Esta é a sua senha temporária:
                      </p>

                      <div style="margin: 30px 0; padding: 20px; background-color: #f8f8f8; border-radius: 5px; text-align: center;">
                        <code style="font-size: 24px; color: #eab308; font-weight: bold; letter-spacing: 2px;">
                          ${tempPassword}
                        </code>
                      </div>

                      <p style="margin: 20px 0; color: #333; font-size: 16px; line-height: 1.5; text-align: center;">
                        Use esta senha temporária para entrar. Recomendamos trocá-la logo depois de entrar.
                      </p>

                      <table role="presentation" style="width: 100%; margin: 30px 0;">
                        <tr>
                          <td align="center">
                            <a href="${loginLink}"
                               style="display: inline-block; padding: 14px 30px; background-color: #eab308; color: #000000; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
                              Entrar agora
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin: 20px 0 0; color: #666; font-size: 14px; text-align: center;">
                        Por segurança, troque esta senha assim que entrar.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 20px; background-color: #1a1a1a; color: #ffffff; text-align: center;">
                      <p style="margin: 0; font-size: 14px;">
                        © ${new Date().getFullYear()} ReactioN MMO. Todos os direitos reservados.
                      </p>
                      <p style="margin: 10px 0 0; font-size: 12px; color: #999;">
                        Se você não pediu esta redefinição de senha, fale com o suporte imediatamente.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    }

    await transporter.verify()
    const info = await transporter.sendMail(mailOptions)
    console.log('Email de mot de passe temporaire envoye :', info.messageId)
    return true
  } catch (error) {
    console.error('Erro ao enviar o e-mail com a senha temporária:', {
      message: error.message,
      code: error.code,
      command: error.command
    })
    return false
  }
}