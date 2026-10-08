export type DemoSample = {
  id: string; label: string; context: string; contact: string
  fragments: { text: string; kind?: 'person' | 'commitment' | 'blocker' | 'timing' }[]
  commitment?: { title: string; detail: string; when: string }
  recommendation?: { title: string; detail: string; when: string; why: string }
  insight: string; summary: string
}
export const demoSamples: DemoSample[] = [
  {id:'technical',label:'A trial needs approval',context:'Equipment sales · After a site visit',contact:'Maya — Northstar',
    fragments:[{text:'Just saw '},{text:'Maya at Northstar',kind:'person'},{text:'. Um, she likes the A4, but '},{text:'her engineer needs to review it before a trial',kind:'blocker'},{text:'. '},{text:'Send her the spec sheet tomorrow — no prices',kind:'commitment'},{text:'. '},{text:'She’ll talk to him Thursday.',kind:'timing'}],
    commitment:{title:'Send spec sheet to Maya',detail:'A4 specifications only. No prices.',when:'Tomorrow · 9:00 AM · proposed time'},
    recommendation:{title:'Check the technical review with Maya',detail:'Ask what her engineer needs to approve a trial.',when:'Friday · 3:00 PM · proposed schedule',why:'Engineer approval is the blocker; Maya speaks with him Thursday.'},
    insight:'Technical approval needed. No trial or order agreed yet.',
    summary:'Maya is interested in the A4, but her engineer must review it before a trial can be approved. She plans to speak with him on Thursday. No trial or order has been agreed.'},
  {id:'commitment',label:'A promise to keep',context:'Distribution · After a customer call',contact:'Elena — Valley Supply',
    fragments:[{text:'Okay, spoke to '},{text:'Elena at Valley Supply',kind:'person'},{text:'. She just needs the updated list, um, '},{text:'send the wholesale prices tomorrow at 10 AM',kind:'commitment'},{text:'. '},{text:'No samples for now',kind:'blocker'},{text:'. She’ll come back to us when she needs anything. '},{text:'Don’t chase her this week.',kind:'timing'}],
    commitment:{title:'Send wholesale prices to Elena',detail:'The updated price list only. Do not send samples.',when:'Tomorrow · 10:00 AM'},
    insight:'Elena will get back in touch when needed. No extra follow-up this week.',
    summary:'Elena requested the updated wholesale price list. She does not want samples and will get back in touch when needed. The salesperson said not to chase her this week.'},
  {id:'interest',label:'Interest, no commitment',context:'Field sales · After a farm visit',contact:'Jordan — Cedar Farms',
    fragments:[{text:'Met '},{text:'Jordan at Cedar Farms',kind:'person'},{text:'. He’s interested in a small trial, but, uh, '},{text:'he doesn’t know what it would cost',kind:'blocker'},{text:'. He’s '},{text:'comparing options next week',kind:'timing'},{text:'. I didn’t promise a quote or agree a call. No order yet.'}],
    recommendation:{title:'Clarify the trial scope with Jordan',detail:'Ask what area he wants to test so you can prepare a relevant cost estimate.',when:'Tomorrow · 9:00 AM · proposed schedule',why:'Cost is the open question, and he is comparing options next week.'},
    insight:'Interest is not approval. No quote, call or order was agreed.',
    summary:'Jordan is interested in a small trial but does not know what it would cost. He is comparing options next week. No quote, call or order was agreed.'},
]
export function sampleCrm(sample: DemoSample) {
  return `${sample.contact}\n\n${sample.summary}${sample.commitment ? `\n\nNext steps:\n- ${sample.commitment.title}: ${sample.commitment.detail} (${sample.commitment.when})` : ''}${sample.recommendation ? `\n\nProposed follow-up:\n- ${sample.recommendation.title}: ${sample.recommendation.detail} (${sample.recommendation.when})` : ''}`
}
