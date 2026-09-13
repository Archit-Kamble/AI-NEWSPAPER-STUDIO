# Photographs are continuous tone; type is black on white. Mark mid-tone or
# saturated pixels, pool them in 8px cells, and take connected components.
import sys, json
from PIL import Image
name=sys.argv[1]; K=8
im=Image.open(name+'.jpg').convert('RGB'); W,H=im.size
hsv=im.convert('HSV')
small=Image.new('L',(W//K,H//K))
px=im.load(); hp=hsv.load()
sw,sh=W//K,H//K
grid=[[0]*sw for _ in range(sh)]
for cy in range(sh):
    for cx in range(sw):
        n=0
        for dy in (1,4,7):
            for dx in (1,4,7):
                x=cx*K+dx; y=cy*K+dy
                r,gg,b=px[x,y]; v=(r+gg+b)//3; s=hp[x,y][1]
                if (45<v<205) or (s>70 and v<235): n+=1
        grid[cy][cx]=1 if n>=5 else 0
seen=[[0]*sw for _ in range(sh)]; boxes=[]
for y in range(sh):
    for x in range(sw):
        if grid[y][x] and not seen[y][x]:
            st=[(x,y)]; seen[y][x]=1; x0=x1=x; y0=y1=y; cnt=0
            while st:
                a,b=st.pop(); cnt+=1
                x0=min(x0,a);x1=max(x1,a);y0=min(y0,b);y1=max(y1,b)
                for c,d in ((a+1,b),(a-1,b),(a,b+1),(a,b-1)):
                    if 0<=c<sw and 0<=d<sh and grid[d][c] and not seen[d][c]:
                        seen[d][c]=1; st.append((c,d))
            bw=(x1-x0+1)*K; bh=(y1-y0+1)*K
            if bw>=120 and bh>=120 and cnt/((x1-x0+1)*(y1-y0+1))>0.45:
                boxes.append([x0*K,y0*K,(x1+1)*K,(y1+1)*K,round(cnt/((x1-x0+1)*(y1-y0+1)),2)])
boxes=[b for b in boxes if b[1]>260 and b[3]<4330]
json.dump(boxes,open(name+'-photos.json','w'))
for b in boxes: print(b)
