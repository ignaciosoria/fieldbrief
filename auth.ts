import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import {hasCalendarScope} from './lib/googleCalendarScope'
import {storeGoogleCalendarConnection} from './lib/googleCalendarConnection'

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
    error: '/auth/error',
  },
  events: {
    async signIn({user,account,profile}) {
      if(account?.provider!=='google' || !hasCalendarScope(account.scope || '') || !user.email ||
        profile?.email_verified!==true || profile.email?.toLowerCase()!==user.email.toLowerCase() ||
        !account.access_token || !account.expires_at)return
      // Do not expose tokens through the public session or break ordinary sign-in
      // if the optional calendar connection cannot be saved.
      try {
        await storeGoogleCalendarConnection({email:user.email,subject:account.providerAccountId,
          accessToken:account.access_token,refreshToken:account.refresh_token,
          expiresAt:account.expires_at,scope:account.scope!})
      } catch {console.error('Google Calendar connection could not be stored')}
    },
  },
})
