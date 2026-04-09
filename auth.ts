import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

/** En Google Cloud Console → “Authorized redirect URIs”: `{NEXTAUTH_URL}/api/auth/callback/google` (p. ej. producción `https://folup.app/...`). */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/',
  },
})
