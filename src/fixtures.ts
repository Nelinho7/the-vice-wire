import type { Candidate, Extraction, SourceItem } from './model.ts';
export const fixtureNow='2026-10-04T12:00:00.000Z';
type Label = { useful:boolean; group?:string; stance?:string; ambiguous?:boolean; copied?:boolean };
export type Fixture = { source:SourceItem; label:Label; extraction:Extraction };
const acid:Candidate={category:'money',claim:'A full upgraded Acid Lab sale pays approximately GTA$350,000 in an invite-only session.',predicate:'sale_payout',entities:['Acid Lab'],conditions:{game:'GTA Online',upgrade:'equipment',session:'invite-only',stock:'full'},values:[{name:'payout',value:350000,unit:'GTA$'}],stance:'supports',quote:''};
const bug:Candidate={category:'bug',claim:'The Casino Heist planning board can freeze when opening it after joining a public session.',predicate:'planning_board_freezes',entities:['Casino Heist'],conditions:{game:'GTA Online',session:'public',trigger:'after joining'},values:[],stance:'supports',quote:''};
const vehicle:Candidate={category:'vehicle',claim:'A Sultan can spawn at the prison parking lot at night.',predicate:'vehicle_spawn',entities:['Sultan','Bolingbroke Penitentiary'],conditions:{game:'GTA V',time:'night'},values:[],stance:'supports',quote:''};
const rows:{text:string;candidate?:Candidate;label:Label;author?:string;copy?:string;hours?:number;score?:number;thread?:string}[]=[
  {text:'Acid Lab is making me about 350k. Full stock with the equipment upgrade, invite-only session.',candidate:acid,label:{useful:true,group:'acid',stance:'supports'}},
  {text:'The acid business still pays roughly $350,000. I sold full upgraded stock in invite-only today.',candidate:{...acid,entities:['acid business']},label:{useful:true,group:'acid',stance:'supports'}},
  {text:'Made 347k from my Acid Lab. Full stock, equipment upgrade, invite-only.',candidate:{...acid,values:[{name:'payout',value:347000,unit:'GTA$'}]},label:{useful:true,group:'acid',stance:'supports'}},
  {text:'Acid Lab is making me about 350k. Full stock with the equipment upgrade, invite-only session.',candidate:acid,label:{useful:true,group:'acid',stance:'supports',copied:true},copy:'fixture:1'},
  {text:'That full upgraded Acid Lab invite-only payout report is wrong: I only got 250k today.',candidate:{...acid,stance:'contradicts',values:[{name:'payout',value:250000,unit:'GTA$'}]},label:{useful:true,group:'acid',stance:'contradicts'}},
  {text:'Full upgraded Acid Lab stock sold for 600k in a public session with the lobby bonus.',candidate:{...acid,conditions:{...acid.conditions,session:'public'},values:[{name:'payout',value:600000,unit:'GTA$'}]},label:{useful:true,group:'acid-public',stance:'supports'}},
  {text:'My full upgraded Acid Lab sold for 350k today. I forgot which session I used.',candidate:{...acid,conditions:{game:'GTA Online',upgrade:'equipment',stock:'full'}},label:{useful:true,group:'acid-ambiguous',stance:'supports',ambiguous:true}},
  {text:'Casino Heist planning board freezes after I join a public session. Reproduced twice on PC.',candidate:bug,label:{useful:true,group:'board',stance:'supports'}},
  {text:'I can reproduce the Casino Heist planning board freeze after joining public lobbies.',candidate:bug,label:{useful:true,group:'board',stance:'supports'}},
  {text:'For the Casino Heist frozen planning board after public join, switching to invite-only fixed it for me.',candidate:{...bug,category:'workaround',predicate:'board_workaround',claim:'Switching to invite-only may fix the frozen Casino Heist planning board.',conditions:{game:'GTA Online',problem:'frozen planning board',action:'switch to invite-only'}},label:{useful:true,group:'fix',stance:'supports'}},
  {text:'Found a Sultan in Bolingbroke prison parking lot at night in story mode.',candidate:vehicle,label:{useful:true,group:'sultan',stance:'supports'}},
  {text:'I checked Bolingbroke prison parking lot at night three times and did not see a Sultan.',candidate:{...vehicle,stance:'contradicts'},label:{useful:true,group:'sultan',stance:'contradicts'}},
  {text:'Tested solo Cluckin Bell raid: using the railway tunnel to lose cops worked twice.',candidate:{category:'strategy',claim:'The railway tunnel can help solo Cluckin Bell raid players lose police.',predicate:'lose_police',entities:['Cluckin Bell raid','railway tunnel'],conditions:{game:'GTA Online',players:'solo'},values:[],stance:'supports',quote:''},label:{useful:true,group:'tunnel',stance:'supports'}},
  {text:'My test of the railway tunnel in solo Cluckin Bell raid was inconclusive; cops kept searching.',candidate:{category:'strategy',claim:'The railway tunnel can help solo Cluckin Bell raid players lose police.',predicate:'lose_police',entities:['Cluckin Bell raid','railway tunnel'],conditions:{game:'GTA Online',players:'solo'},values:[],stance:'uncertain',quote:''},label:{useful:true,group:'tunnel',stance:'uncertain'}},
  {text:'Maybe GTA 6 will have a secret moon casino. No evidence, just a theory.',label:{useful:false}},
  {text:'GTA 6 hype! Best game ever!!!',label:{useful:false}},
  {text:'Look at this sunset screenshot, beautiful.',label:{useful:false}},
  {text:'Who knows how to make money? Any tips?',label:{useful:false}},
  {text:'You are all idiots. This community is terrible.',label:{useful:false}},
  {text:'Meme: when the cops catch you buying snacks.',label:{useful:false}},
  {text:'I like the old GTA soundtrack more.',label:{useful:false}},
  {text:'Anyone watching football tonight?',label:{useful:false}},
  {text:'Full upgraded Acid Lab invite-only sale paid 349k in my test.',candidate:{...acid,values:[{name:'payout',value:349000,unit:'GTA$'}]},label:{useful:true,group:'acid',stance:'supports'},author:'player1'},
  {text:'Full upgraded Acid Lab invite-only sale paid 900k in my test.',candidate:{...acid,values:[{name:'payout',value:900000,unit:'GTA$'}]},label:{useful:true,group:'acid',stance:'supports'}},
  {text:'Casino Heist planning board freeze after joining public reproduced again.',candidate:bug,label:{useful:true,group:'board',stance:'supports'},hours:200},
];
export const fixtures:Fixture[]=rows.map((r,i)=>{
  const id='fixture:'+(i+1);
  return {source:{id,platform:'fixture',sourceId:String(i+1),url:'https://example.invalid/vice-wire-fixtures/'+(i+1),author:r.author??'player'+(i+1),title:'Synthetic GTA community report',text:r.text,timestamp:new Date(Date.parse(fixtureNow)-(r.hours??i)*3600000).toISOString(),engagement:{score:r.score??10+i},ingestedAt:fixtureNow,raw:{synthetic:true,thread:r.thread??'thread'+i},independenceKey:r.author??'player'+(i+1),...(r.copy?{copiedFrom:r.copy}:{})},label:r.label,extraction:r.candidate?{kind:'INTEL',candidates:[{...r.candidate,quote:r.text}]}:{kind:'NO_INTEL',reason:'Labeled chatter'}};
});
