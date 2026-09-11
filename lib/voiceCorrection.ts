import {appendVisitCorrection} from './visitCorrection'

/** Tab-local checkpoint. Keep the original audio until the correction is accepted. */
export type VoiceCorrectionDraft<Result> = {
  blob:Blob; owner:string; noteId:string; originalTranscript:string;
  referenceNow:string; noteTimezone:string; capturedAt:string; correctionTimezone:string;
  correction?:string; combined?:string; result?:Result;
}

export class CorrectionOwnerChanged extends Error {
  constructor() {super('Correction account changed')}
}

/** Resume only the failed stage. All checkpoints retain the same note and dates. */
export async function resumeVoiceCorrection<Result>(draft:VoiceCorrectionDraft<Result>, deps:{
  currentOwner:()=>string|null; checkpoint:(draft:VoiceCorrectionDraft<Result>)=>void;
  transcribe:(blob:Blob)=>Promise<string>;
  structure:(note:string,now:string,timezone:string)=>Promise<Result>;
  accept:(result:Result,transcript:string,noteId:string)=>Promise<void>;
}) {
  const assertOwner=()=>{if(!draft.owner || draft.owner!==deps.currentOwner()) throw new CorrectionOwnerChanged()}
  let next={...draft}
  assertOwner()
  if (!next.combined) {
    const correction=(await deps.transcribe(next.blob)).trim()
    assertOwner()
    if(!correction) throw Error('No speech was detected. Your correction recording is still here.')
    next={...next,correction,combined:appendVisitCorrection(next.originalTranscript,correction,next.capturedAt,next.correctionTimezone)}
    deps.checkpoint(next)
  }
  if (!next.result) {
    const result=await deps.structure(next.combined!,next.referenceNow,next.noteTimezone)
    assertOwner()
    next={...next,result}
    deps.checkpoint(next)
  }
  assertOwner()
  await deps.accept(next.result!,next.combined!,next.noteId)
  assertOwner()
}
