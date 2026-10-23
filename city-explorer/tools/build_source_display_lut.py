"""Bake the installed Blender OCIO AgX + source Look into a browser display LUT."""
from pathlib import Path
import json, hashlib, math
import numpy as np
import PyOpenColorIO as ocio

BASE=Path('/Users/zstar/worldcity/city-explorer')
CONFIG=Path('/Applications/Blender.app/Contents/Resources/4.5/datafiles/colormanagement/config.ocio')
OUT=BASE/'public/render';OUT.mkdir(parents=True,exist_ok=True)
config=ocio.Config.CreateFromFile(str(CONFIG))
look=ocio.LookTransform(src='Linear Rec.709',dst='Linear Rec.709',looks='AgX - Medium High Contrast')
display=ocio.DisplayViewTransform(src='Linear Rec.709',display='sRGB',view='AgX')
# The config has no implicit display Look. Bypass it explicitly to avoid accidental double application.
assert config.getDisplayViewLooks('sRGB','AgX')==''
display.setLooksBypass(True)
group=ocio.GroupTransform([look,display])
processor=config.getProcessor(group).getDefaultCPUProcessor()
shape_scale=64.;shape_max=4096.;denominator=math.log2(1+shape_scale*shape_max)
def shape(rgb):return np.log2(1+shape_scale*np.clip(rgb,0,shape_max))/denominator
def unshape(u):return np.expm1(u*denominator*math.log(2))/shape_scale
def reference(rgb):
    out=np.ascontiguousarray(rgb,dtype=np.float32).copy();processor.applyRGB(out);return np.clip(out,0,1)
def interpolate(lut,rgb):
    n=lut.shape[0];pos=shape(rgb)*(n-1);lo=np.floor(pos).astype(int);hi=np.minimum(lo+1,n-1);f=pos-lo
    result=np.zeros_like(pos)
    for bz in range(2):
        for gy in range(2):
            for rx in range(2):
                ids=[hi[:,axis] if bit else lo[:,axis] for axis,bit in enumerate([rx,gy,bz])]
                weights=np.prod(np.stack([f[:,axis] if bit else 1-f[:,axis] for axis,bit in enumerate([rx,gy,bz])],axis=1),axis=1)
                result+=lut[ids[2],ids[1],ids[0],:3]*weights[:,None]
    return result
rng=np.random.default_rng(20261023)
samples={
 'sceneLinear_0_4':rng.uniform(0,4,(30000,3)),
 'allHDRLogShaper':unshape(rng.uniform(0,1,(30000,3))),
 'grayRamp':np.repeat(np.geomspace(.00001,4096,4096)[:,None],3,axis=1),
}
def errors(lut):
    results={}
    for name,points in samples.items():
        error=np.abs(interpolate(lut,points)-reference(points));channel=error.reshape(-1)
        index=np.unravel_index(np.argmax(error),error.shape)
        results[name]={'samples':len(points),'meanAbs':float(channel.mean()),'p95Abs':float(np.quantile(channel,.95)),'p99Abs':float(np.quantile(channel,.99)),'maxAbs':float(channel.max()),'maxErrorInput':points[index[0]].tolist()}
    return results
def generate(n):
    u=np.linspace(0,1,n,dtype=np.float64)
    b,g,r=np.meshgrid(u,u,u,indexing='ij')
    grid=unshape(np.stack([r,g,b],axis=-1)).astype(np.float32)
    result=reference(grid)
    rgba=np.concatenate([result,np.ones((*result.shape[:-1],1),dtype=np.float32)],axis=-1).astype('<f2')
    return rgba
size=64;lut=generate(size);verification=errors(lut.astype(np.float32))
path=OUT/'agx-medium-high.bin';path.write_bytes(lut.tobytes(order='C'))
meta={
 'version':1,'size':size,'format':'RGBA16F','elementType':'IEEE754 binary16 little-endian','channels':4,
 'axisOrder':'R-fastest; index=((B*size+G)*size+R)*4+channel; Three.Data3DTexture width=R,height=G,depth=B',
 'texture':{'url':'agx-medium-high.bin','minFilter':'LinearFilter','magFilter':'LinearFilter','wrapS':'ClampToEdgeWrapping','wrapT':'ClampToEdgeWrapping','wrapR':'ClampToEdgeWrapping','generateMipmaps':False,'colorSpace':'NoColorSpace'},
 'input':{'colorSpace':'Linear Rec.709 / Linear-sRGB','range':[0,shape_max],'exposureIncluded':False,'sourceExposureEV':.30000001192092896,'sourceExposureMultiplier':2**.30000001192092896},
 'shaper':{'scale':shape_scale,'maximum':shape_max,'logDenominator':denominator,'forward':'u=log2(1+64*clamp(linear,0,4096))/log2(1+64*4096)','inverse':'linear=(2^(u*log2(1+64*4096))-1)/64','textureCoordinate':'(u*(size-1)+0.5)/size'},
 'output':{'colorSpace':'display-encoded sRGB (already nonlinear)','range':[0,1],'alpha':1,'additionalToneMapping':False,'additionalSRGBEncoding':False},
 'pipeline':{'ocioVersion':ocio.__version__,'config':str(CONFIG),'configSHA256':hashlib.sha256(CONFIG.read_bytes()).hexdigest(),'source':'Linear Rec.709','look':'AgX - Medium High Contrast','lookProcessSpace':'AgX Log','display':'sRGB','view':'AgX','implicitDisplayLooks':config.getDisplayViewLooks('sRGB','AgX'),'displayLooksBypass':True,'order':['explicit LookTransform Linear Rec.709 -> Linear Rec.709','DisplayViewTransform sRGB/AgX with implicit Looks bypassed','clamp to SDR [0,1]','float16 storage']},
 'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
 'verification':verification,
 'limitations':['Finite trilinear LUT approximates exact OCIO transform; errors are measured against CPU float32 processing below.','Negative input components clamp to zero and components above4096 clamp to4096.','Exposure is external; apply it exactly once before the log shaper.','Output is display encoded; omit both Three tone mapping and colorspace_fragment after lookup.']
}
(OUT/'agx-medium-high.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
calibration=BASE/'audit/sun-calibration.json'
calibration_png=BASE/'audit/sun-calibration-display.png'
if calibration.exists() and calibration_png.exists():
    from PIL import Image
    cal=json.loads(calibration.read_text())
    source=np.asarray(cal['linearDiffuseRGB'],dtype=np.float32)*2**.3
    expected=np.round(reference(source)*255).astype(int).tolist()
    actual=list(Image.open(calibration_png).convert('RGB').getpixel((8,8)))
    assert max(abs(a-b) for a,b in zip(actual,expected))<=1
    meta['verification']['blenderDisplayCrossCheck']={'sourceLinear':cal['linearDiffuseRGB'],'exposureEV':.3,'blenderPNG8Bit':actual,'cpuExpected8Bit':expected,'withinOne8bitLevel':True}
    (OUT/'agx-medium-high.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
(BASE/'audit/display-lut-verification.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
print(json.dumps({'size':size,'bytes':meta['bytes'],'verification':verification},indent=2))
