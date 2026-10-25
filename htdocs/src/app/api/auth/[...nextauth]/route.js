import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          // Replace this with your actual authentication logic
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          })

          const data = await res.json()

          if (res.ok && data.user) {
            return {
              id: data.user.id,
              email: data.user.email,
              name: data.user.username,
              // Add any other user data you want to store in the session
            }
          }

          throw new Error(data.error || 'Invalid credentials')
        } catch (error) {
          throw new Error(error.message || 'Authentication failed')
        }
      }
    })
  ],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        // Add any additional user data to the token
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id
        // Add any additional user data to the session
      }
      return session
    }
  },
  session: {
    strategy: 'jwt',
  },
})

export { handler as GET, handler as POST } 