import { checkAiAccess, type AiAccessDependencies } from './aiAccess'
import { readStructureInput } from './structureInput'

/** Authenticate, validate, then reserve exactly once with the server identity. */
export async function prepareStructure(request: Request, deps: AiAccessDependencies & {readInput:typeof readStructureInput}) {
  let email:string|null
  try {email=await deps.getEmail()} catch {
    return Response.json({error:'Unable to verify access.',code:'ACCESS_UNAVAILABLE'},{status:503})
  }
  if(!email) return Response.json({error:'Sign in to process a note.',code:'AUTH_REQUIRED'},{status:401})
  const body=await deps.readInput(request)
  if(body instanceof Response) return body
  const denied=await checkAiAccess('structure',{getEmail:async()=>email,reserve:deps.reserve})
  return denied || body
}
