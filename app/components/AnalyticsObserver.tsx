'use client'
import {useEffect} from 'react'
import {usePathname} from 'next/navigation'
import {useSession} from 'next-auth/react'
import {initPosthog,refreshAnalyticsContext,trackPageview,trackSigninComplete,trackSigninFailure,expireSignin,setAnalyticsInternal} from '../../lib/posthog'
export default function AnalyticsObserver(){
  const path=usePathname(),{status}=useSession()
  useEffect(()=>{const test=new URLSearchParams(location.search).get('analytics_test');if(test==='1'||test==='0')setAnalyticsInternal(test==='1');initPosthog();trackPageview(path);if(path==='/auth/error')trackSigninFailure()},[path])
  useEffect(()=>{if(status==='loading')return;let active=true;void refreshAnalyticsContext().then(()=>{if(!active)return;if(status==='authenticated')trackSigninComplete();else expireSignin()});return()=>{active=false}},[status])
  return null
}
