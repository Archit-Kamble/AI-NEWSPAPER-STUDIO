import sys
from PIL import Image
name=sys.argv[1]
g=Image.open(name+'.jpg').convert('L')
W,H=g.size
ink=g.point(lambda v:255 if v<170 else 0)          # ink mask
rowm=list(ink.resize((1,H),Image.BOX).getdata())
colm=list(ink.resize((W,1),Image.BOX).getdata())
r=[y for y,v in enumerate(rowm) if v>6]; c=[x for x,v in enumerate(colm) if v>6]
print('size',W,H,'ink rows',r[0],r[-1],'ink cols',c[0],c[-1])
# long horizontal rules: shrink horizontally by k, a pixel ==255 means a solid run of k
k=140
sm=ink.resize((W//k,H),Image.BOX)
sw,sh=sm.size; px=sm.load()
rules=[]
for y in range(sh):
    run=0;best=(0,0)
    for x in range(sw):
        if px[x,y]>=250: run+=1
        else:
            if run>best[0]: best=(run,x)
            run=0
    if run>best[0]: best=(run,sw)
    if best[0]>=3: rules.append((y,(best[1]-best[0])*k,best[1]*k))
out=[]
for y,a,b in rules:
    if out and y-out[-1][1]<=4 and abs(a-out[-1][2])<=k: out[-1][1]=y; out[-1][3]=max(out[-1][3],b)
    else: out.append([y,y,a,b])
print('H rules y0-y1 x0-x1:'); [print('  ',o) for o in out]
# vertical rules: shrink vertically
k2=160
sv=ink.resize((W,H//k2),Image.BOX); p2=sv.load(); vw,vh=sv.size
vr=[]
for x in range(vw):
    run=0;best=(0,0)
    for y in range(vh):
        if p2[x,y]>=250: run+=1
        else:
            if run>best[0]: best=(run,y)
            run=0
    if run>best[0]: best=(run,vh)
    if best[0]>=3: vr.append((x,(best[1]-best[0])*k2,best[1]*k2))
vo=[]
for x,a,b in vr:
    if vo and x-vo[-1][1]<=4: vo[-1][1]=x; vo[-1][2]=min(vo[-1][2],a); vo[-1][3]=max(vo[-1][3],b)
    else: vo.append([x,x,a,b])
print('V rules x0-x1 y0-y1:'); [print('  ',o) for o in vo]
