import { Room, RoomEvent, AudioSource, AudioFrame, AudioStream, LocalAudioTrack, TrackPublishOptions, TrackSource, dispose } from '@livekit/rtc-node';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base='http://localhost:3001/v1', headers={origin:'http://localhost:5173','x-warp-client':'web','content-type':'application/json'};
const password='Voice-local-test-123!';
async function req(u,method,path,body){const r=await fetch(base+path,{method,headers:{...headers,...u?{cookie:u.cookie,'x-csrf-token':u.csrfToken}:{}},body:method==='GET'?undefined:JSON.stringify(body??{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
async function reg(){const username='voice_'+randomUUID().slice(0,8);const r=await fetch(base+'/auth/register',{method:'POST',headers,body:JSON.stringify({username,email:username+'@example.test',displayName:username,password})});assert.equal(r.status,201);return{...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
const a=await reg(),b=await reg();const rooms=[new Room(),new Room()],sources=[],tracks=[],readers=[];let server;
const timeout=setTimeout(()=>{console.error('Voice test timeout');process.exit(1);},45000);
try{
 server=(await req(a,'POST','/servers',{name:'Voice integration test'})).server;
 const channel=server.channels.find(c=>c.kind==='VOICE');
 const invite=await req(a,'POST',`/servers/${server.id}/invites`,{hours:1,maxUses:1});await req(b,'POST','/invites/join',{code:invite.code});
 const received=[0,0],energy=[0,0];
 for(let i=0;i<2;i++){rooms[i].on(RoomEvent.TrackSubscribed,track=>{const reader=new AudioStream(track,48000,1).getReader();readers.push(reader);void(async()=>{while(true){const{value,done}=await reader.read();if(done)break;received[i]++;energy[i]+=value.data.reduce((n,x)=>n+Math.abs(x),0);}})().catch(()=>{});});const grant=await req(i?a:b,'POST',`/channels/${channel.id}/voice`);await rooms[i].connect(grant.url,grant.token,{autoSubscribe:true});}
 for(const room of rooms){const source=new AudioSource(48000,1),track=LocalAudioTrack.createAudioTrack('test-tone',source),options=new TrackPublishOptions();options.source=TrackSource.SOURCE_MICROPHONE;await room.localParticipant.publishTrack(track,options);sources.push(source);tracks.push(track);}
 for(let frame=0;frame<200;frame++){await Promise.all(sources.map((source,index)=>{const samples=Int16Array.from({length:480},(_,i)=>Math.round(8000*Math.sin(2*Math.PI*(440+index*220)*(frame*480+i)/48000)));return source.captureFrame(new AudioFrame(samples,48000,1,480));}));await new Promise(r=>setTimeout(r,10));}
 await Promise.all(sources.map(s=>s.waitForPlayout()));
 assert.ok(received.every(n=>n>10),`frames=${received}`);assert.ok(energy.every(n=>n>10000),`energy=${energy}`);
 // Room 0 is B: owner A can disconnect that participant through WARP's API.
 const disconnected=new Promise(resolve=>rooms[0].once(RoomEvent.Disconnected,resolve));
 await req(a,'POST',`/channels/${channel.id}/voice/moderate`,{identity:rooms[0].localParticipant.identity,action:'disconnect'});await disconnected;
 await rooms[1].disconnect();
 await req(a,'POST','/friends',{username:b.user.username});
 const friendship=(await req(b,'GET','/friends')).friends[0];await req(b,'POST',`/friends/${friendship.id}/accept`);
 const dm=(await req(a,'GET','/friends')).friends[0].channel;
 await req(a,'POST',`/channels/${dm.id}/call`);
 for(let i=0;i<2;i++){const grant=await req(i?a:b,'POST',`/channels/${dm.id}/voice`);await rooms[i].connect(grant.url,grant.token,{autoSubscribe:true});}
 assert.equal(rooms[0].name,rooms[1].name);
 const report={privateCallJoined:true,passed:true,server:'LiveKit 1.13.9 local Windows',transport:'two real WebRTC SDK clients, Opus audio, synthetic tones',framesReceived:received,nonzeroAudioEnergy:energy,moderationDisconnect:true,differentDevicesOrNetworks:false};
 await writeFile('voice-test-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 for(const reader of readers)await reader.cancel().catch(()=>{});for(const room of rooms)await room.disconnect().catch(()=>{});for(const t of tracks)await t.close();for(const s of sources)await s.close();
 await req(a,'DELETE','/voice/current').catch(()=>{});await req(b,'DELETE','/voice/current').catch(()=>{});if(server)await req(a,'DELETE',`/servers/${server.id}`);await req(a,'DELETE','/users/me',{password});await req(b,'DELETE','/users/me',{password});clearTimeout(timeout);await dispose();
}
