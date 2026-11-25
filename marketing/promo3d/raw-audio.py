#!/usr/bin/env python3
"""Trilha curta (13 s) do corte orgânico, sintetizada. Uso: python3 raw-audio.py out/raw-audio.wav"""
import sys, wave, numpy as np
SR=48000; DUR=13.0; N=int(SR*DUR); BPM=124; BEAT=60/BPM
rng=np.random.default_rng(3); L=np.zeros(N)
def at(b,t,s,g=1.0):
    i=int(t*SR); j=min(N,i+len(s)); 
    if i<N: b[i:j]+=s[:j-i]*g
def bp(sig,lo=None,hi=None):
    S=np.fft.rfft(sig); f=np.fft.rfftfreq(len(sig),1/SR); m=np.ones_like(f)
    if lo: m*=1/(1+(lo/np.maximum(f,1))**4)
    if hi: m*=1/(1+(f/hi)**4)
    return np.fft.irfft(S*m,len(sig))
def kick(g=1.0):
    n=int(.4*SR); t=np.arange(n)/SR; f=48+95*np.exp(-t/.04); ph=2*np.pi*np.cumsum(f)/SR
    return (np.sin(ph)*np.exp(-t/.15))*g
def hat(o=False):
    n=int((.16 if o else .05)*SR); t=np.arange(n)/SR
    return bp(rng.standard_normal(n),lo=7000)*np.exp(-t/(.06 if o else .015))
def note(m): return 440*2**((m-69)/12)
def tone(fr,d,h=5,dec=.3):
    n=int(d*SR); t=np.arange(n)/SR; s=np.zeros(n)
    for k in range(1,h+1): s+=np.sin(2*np.pi*fr*k*t)/k
    return s*np.minimum(1,t/.005)*np.exp(-t/dec)
def riser(t0,t1,g=.3):
    n=int((t1-t0)*SR); noise=rng.standard_normal(n); hop=1024; out=np.zeros(n+hop*2); win=np.hanning(hop*2)
    for st in range(0,n,hop):
        seg=noise[st:st+hop*2]
        if len(seg)<hop*2: seg=np.pad(seg,(0,hop*2-len(seg)))
        p=st/n; fc=400*(14)**p
        out[st:st+hop*2]+=bp(seg*win,fc*.5,fc*1.5)
    at(L,t0,(out[:n]/(np.max(np.abs(out))+1e-9))*np.linspace(0,1,n)**2,g)
def whoosh(t,d=.4,g=.3):
    n=int(d*SR); at(L,t-d*.5,(riser_seg(d))*np.hanning(n),g)
def riser_seg(d):
    n=int(d*SR); noise=rng.standard_normal(n); hop=512; out=np.zeros(n+hop*2); win=np.hanning(hop*2)
    for st in range(0,n,hop):
        seg=noise[st:st+hop*2]
        if len(seg)<hop*2: seg=np.pad(seg,(0,hop*2-len(seg)))
        p=st/n; fc=4000*(.1)**p
        out[st:st+hop*2]+=bp(seg*win,fc*.6,fc*1.4)
    return out[:n]/(np.max(np.abs(out))+1e-9)
# groove leve 0.3s -> fim
CH=[57,53,60,55]; b=0.3; i=0
while b<DUR-0.3:
    bar=i%4
    at(L,b,kick(),.9)
    at(L,b+BEAT/2,hat(),.14); at(L,b,hat(),.06)
    if i%8==7: at(L,b+BEAT*.75,hat(True),.1)
    root=CH[(i//4)%4]-12
    at(L,b,tone(note(root),BEAT*.9,5,.25),.3)
    b+=BEAT; i+=1
# efeitos nos cortes de legenda
for t in (0.35,2.7,5.2,9.4):
    whoosh(t,.4,.28)
riser(5.2,7.4,.32)
at(L,7.5,kick(1.2)*0.9,.5)                      # bate ao chegar em 200%
at(L,7.5,tone(note(81),.5,3,.25),.2)
whoosh(11.2,.5,.3); at(L,11.3,kick(1.2),.5)     # final
at(L,11.4,tone(note(88),.6,3,.3),.22)
# mix
L/=np.max(np.abs(L))+1e-9
fade=np.ones(N); fade[-int(.5*SR):]=np.linspace(1,0,int(.5*SR)); L*=fade
L=np.tanh(L*1.5)/np.tanh(1.5)*.95
st=np.stack([L,L],1)
with wave.open(sys.argv[1],"wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype("<i2").tobytes())
print(sys.argv[1])
