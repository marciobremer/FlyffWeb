import CredentialsProvider from 'next-auth/providers/credentials'
import { connectToDatabase } from '@/lib/db'
import bcrypt from 'bcrypt'

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          const db = await connectToDatabase()
          
          const result = await db.query`
            SELECT 
              email,
              password_hash,
              email_verified,
              is_active,
              role,
              id
            FROM WEBSITE_DBF.dbo.REGISTERED_USERS
            WHERE email = ${credentials.email}
          `

          const user = result.recordset[0]

          if (!user || !user.password_hash) {
            throw new Error('Credenciais inválidas')
          }

          const match = await bcrypt.compare(credentials.password, user.password_hash)

          if (!match) {
            throw new Error('Credenciais inválidas')
          }

          if (!user.email_verified) {
            throw new Error('Verifique seu e-mail antes de entrar')
          }

          if (!user.is_active) {
            throw new Error('A conta está inativa')
          }

          return {
            id: user.id,
            email: user.email,
            role: user.role || 'user'
          }
        } catch (error) {
          throw new Error(error.message || 'Falha na autenticação')
        }
      }
    })
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id
        session.user.role = token.role
      }
      return session
    }
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
} 