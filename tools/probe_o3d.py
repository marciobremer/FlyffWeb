"""Valida o layout do .o3d descrito em ANALYSIS.md contra arquivos reais (Passo 1)."""
import struct, sys
class R:
    def __init__(s,b): s.b=b; s.o=0
    def u(s,fmt):
        v=struct.unpack_from('<'+fmt,s.b,s.o); s.o+=struct.calcsize('<'+fmt); return v if len(v)>1 else v[0]
    def skip(s,n): s.o+=n
def gm(r,typ,info):
    r.skip(24+12)            # bounds + opacity/bump/rigid
    r.skip(28)
    vlc,vc,flc,ic=r.u('4i')
    r.skip(12*vlc)
    r.skip(vc*(44 if typ==1 else 32))   # SkinVertex 44 / NormalVertex 32
    r.skip(2*ic+2*vc)
    if r.u('i'): r.skip(4*vlc)
    mats=[]
    if r.u('i'):
        mc=r.u('i') or 1
        for _ in range(mc):
            r.skip(68); ln=r.u('i'); mats.append(r.b[r.o:r.o+ln].split(b'\0')[0].decode()); r.skip(ln)
    mbc=r.u('i'); r.skip(mbc*(24+4*28+0)) if False else r.skip(mbc*(6*4+28*4))
    info.append((typ,vlc,vc,ic//3,mats,mbc))
def parse(fn):
    b=open(fn,'rb').read(); r=R(b)
    n=r.u('B'); name=bytes(x^0xcd for x in b[1:1+n]); r.skip(n)
    ver=r.u('i'); id_=r.u('i'); r.skip(48 if ver>=22 else 24); r.skip(8+16)
    bounds=r.u('6f'); r.u('f'); frames=r.u('i'); ev=r.u('i'); r.skip(12*ev)
    info=[]
    if r.u('i'): gm(r,0,[])
    lod=r.u('i'); bones=r.u('i')
    if bones:
        r.skip(64*bones*2)
        if frames:
            for _ in range(bones):
                ln=r.u('i'); r.skip(ln+128+4)
            ac=r.u('i')
            for _ in range(bones):
                if r.u('i')==1: r.skip(28*frames)
                else: r.skip(64)
        r.u('i')
    pool=r.u('i')
    for g in range(3 if lod else 1):
        oc=r.u('i')
        for _ in range(oc):
            t=r.u('I'); typ=t&0xffff; ub=r.u('i'); r.skip(4*ub)
            r.u('i'); pid=r.u('i')
            if pid!=-1: r.u('i')
            r.skip(64)
            gm(r,typ,info)
            if typ==0 and frames:
                if r.u('i'): r.skip(28*frames)
    return dict(name=name,ver=ver,bounds=bounds,frames=frames,bones=bones,lod=lod,objs=info,pos=r.o,size=len(b))
if __name__=='__main__':
    for f in sys.argv[1:]:
        d=parse(f); print(f.split('/')[-1],d['ver'],'frames',d['frames'],'bones',d['bones'],'lod',d['lod'],'parsed',d['pos'],'/',d['size'])
        for o in d['objs'][:4]: print('   ',o)
