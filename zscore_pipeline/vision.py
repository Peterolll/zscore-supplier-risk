"""Shared image preparation / GLM-4V classification and evidence extraction."""
from __future__ import annotations
import hashlib
import math
import json
from pathlib import Path
import re
import tempfile
from PIL import Image
from .audit import event, _active
from .evidence import is_prior
from .models import ExtractMethod

CLASSIFY = '''只返回 JSON 对象。判断财报页面文字实际方向，给出使文字正向所需的顺时针 rotation（0/90/180/270）、kind（BS/IS/CF/OTHER）、layout（two-column/single）、unit（元/千元/万元/百万元，找不到返回null）、period（原文期间）、confidence（0至1）。BS左右分别资产和负债权益时才标记two-column。不要根据纸张方向猜测。'''
READ = '''只返回 JSON 对象：{"unit":"原文单位或null","period":"原文期间或null","quality":"clear或blurred","rows":[{"label":"完整原文科目","raw":"原始数字字符串，保留负号和全部位数；空白为null","column":"原文金额列表头","period":"原文期间","bbox":[x0,y0,x1,y1]}]}。bbox是当前输入图的归一化坐标，定位金额所在单元格。只提取本次目标科目及其所有金额列并明确表头，不输出无关明细，禁止取行次/序号。不得换算单位或计算、补零。空白与0不同。保留表内标题、单位、期末/年初、本年/上年列语义。'''


def json_object(raw: str) -> dict:
    cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip())
    value = json.loads(cleaned)
    if not isinstance(value,dict):
        raise ValueError('Expected JSON object')
    return value


def classify_page(image: Image.Image, directory: Path, page: int) -> dict:
    from .ocr_glm import _call_glm
    for attempt, size in enumerate([1100,1800],1):
        thumb=image.copy();thumb.thumbnail((size,size));p=directory/f'page-{page}-orientation-{attempt}.png';thumb.save(p)
        try:
            meta=json_object(_call_glm(p,CLASSIFY))
            if type(meta.get('rotation')) is not int or meta.get('rotation') not in [0,90,180,270] or meta.get('kind') not in ['BS','IS','CF','OTHER'] or not math.isfinite(float(meta.get('confidence',0))) or float(meta.get('confidence',0))<.7:
                raise ValueError('Direction/classification uncertain')
            event('vision.classified',page=page,metadata=meta,attempt=attempt)
            return meta
        except (ValueError,TypeError,json.JSONDecodeError) as exc:
            event('vision.retry',page=page,reason='direction',attempt=attempt,error=str(exc))
    raise ValueError('方向无法确认，请人工转正后重传')


def original_bbox(box: list, region: tuple, rotation: int) -> list[float] | None:
    if not isinstance(box,list) or len(box)!=4 or any(not isinstance(v,(int,float)) or not 0<=v<=1 for v in box):
        return None
    if box[0]>=box[2] or box[1]>=box[3]:
        return None
    x0,y0,x1,y1=region
    points=[]
    for x,y in [(box[0],box[1]),(box[2],box[3]),(box[0],box[3]),(box[2],box[1])]:
        x,y=x0+x*(x1-x0),y0+y*(y1-y0)
        if rotation==90:x,y=y,1-x
        elif rotation==180:x,y=1-x,1-y
        elif rotation==270:x,y=1-y,x
        points.append((x,y))
    return [round(min(x for x,y in points),6),round(min(y for x,y in points),6),round(max(x for x,y in points),6),round(max(y for x,y in points),6)]


def crop(image: Image.Image, region: tuple) -> Image.Image:
    w,h=image.size
    return image.crop((round(region[0]*w),round(region[1]*h),round(region[2]*w),round(region[3]*h)))


def read_region(image: Image.Image, region: tuple, meta: dict, page: int, directory: Path, filename: str):
    from .ocr_glm import _call_glm
    from .m2_extract import LineItem, explicit_unit_scale
    from .m4_map import parse_number, canonical_field
    items=[]
    unit=meta.get('unit');period=meta.get('period')
    # Three bounded attempts, each targeted to the actual failed stage/region.
    reason='initial';target=region;missing=[];conflicted=set()
    targets=meta.get('targets') or (['营业收入','利润总额','利息费用','净利润','所得税费用'] if meta['kind']=='IS' else ['流动资产合计','资产总计','非流动资产合计','流动负债合计','负债合计','所有者权益合计','盈余公积','未分配利润','非流动负债合计'])
    for attempt in range(1,4):
        part=crop(image,target)
        if reason=='local_blur':
            # Enlarging does not add information; use a smaller native region, never guess.
            part=part.resize((part.width*2,part.height*2))
        batch=hashlib.sha256('|'.join(targets).encode()).hexdigest()[:8]
        p=directory/f'page-{page}-region-{region[0]}-{batch}-{attempt}.png';part.save(p)
        prompt=READ+f'\n已识别期间={period}；单位={unit}。本次任务={reason}；目标科目={targets}；重点补抓={missing}。'
        raw=_call_glm(p,prompt)
        event('vision.response',page=page,attempt=attempt,reason=reason,region=target,raw_response=raw,image_sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        try:
            data=json_object(raw)
        except (ValueError,json.JSONDecodeError):
            reason='invalid_json';event('vision.retry',page=page,reason=reason,attempt=attempt);continue
        previous_unit=unit
        unit=data.get('unit') or unit
        declared_scale=explicit_unit_scale('单位：'+str(previous_unit)) if previous_unit else None
        scale=explicit_unit_scale('单位：'+str(unit)) if unit else None
        if scale is None or (declared_scale is not None and scale!=declared_scale):
            event("vision.retry",page=page,reason="unit",conflict=declared_scale is not None and scale!=declared_scale,attempt=attempt)
            header=directory/f'page-{page}-unit.png';crop(image,(0,0,1,.22)).save(header)
            try:
                info=json_object(_call_glm(header,'只返回JSON对象，读取报表标题的计量单位和期间：{"unit":"原文单位或null","period":"原文期间或null"}。不得猜测。'))
                unit=info.get('unit');period=info.get('period') or period
                scale=explicit_unit_scale('单位：'+str(unit)) if unit else None
                event('vision.unit',page=page,unit=unit,period=period)
            except (ValueError,json.JSONDecodeError):
                pass
            if scale is None:
                reason='unit';event('vision.retry',page=page,reason=reason,attempt=attempt);continue
        rows=data.get('rows',[])
        valid=[]
        for row in rows if isinstance(rows,list) else []:
            if not isinstance(row,dict):continue
            label=row.get('label');raw_value=row.get('raw');column=row.get('column')
            if not isinstance(label,str) or not isinstance(column,str) or is_prior(column):continue
            # Only explicit current/amount headers qualify; ambiguous dates remain pending.
            if not re.search(r'期末|年末|本期|本年|本季|current|ending|金额|金額|20\d{2}',column,re.I):continue
            expected_years=re.findall(r'(?<!\d)(20\d{2})(?!\d)',str(meta.get('period') or ''))
            column_years=re.findall(r'(?<!\d)(20\d{2})(?!\d)',column)
            if expected_years and column_years and max(column_years)!=max(expected_years):continue
            box=original_bbox(row.get('bbox'),target,meta['rotation'])
            if box is None or raw_value is None or parse_number(str(raw_value),scale) is None:continue
            valid.append(LineItem(label,str(raw_value),page,ExtractMethod.GLM_OCR,'table',
                source_file=filename,bbox=box,rotation=meta['rotation'],column=column,
                period=str(row.get('period') or (column if re.search(r'20\d{2}',column) else period) or column),unit=str(unit),unit_scale=scale,
                statement=meta['kind'] in ['BS','IS'],consolidated=False))
        # Keep earlier evidence only when a later retry agrees. Conflicts remain unselected.
        for item in valid:
            key=(item.label,item.column,item.period)
            if key in conflicted:continue
            prior=[it for it in items if (it.label,it.column,it.period)==key]
            if prior and any(it.raw_value!=item.raw_value for it in prior):
                items=[it for it in items if (it.label,it.column,it.period)!=key]
                conflicted.add(key)
                event('vision.conflict',page=page,label=item.label)
                continue
            if not prior:items.append(item)
        covered={canonical_field(it.label) for it in items}
        required={'total_assets','total_liabilities','equity_total'} if meta['kind']=='BS' else {'revenue','profit_before_tax'} if meta['kind']=='IS' else set()
        if meta.get('required') is not None:required=set(meta['required'])
        # Split BS regions contain only one side; validate the relevant totals independently.
        if meta['kind']=='BS' and region[2]<1 and not meta.get('required'):required={'total_assets','current_assets'}
        if meta['kind']=='BS' and region[0]>0 and not meta.get('required'):required={'total_liabilities','current_liabilities'} if '负债合计' in targets else {'equity_total'}
        if required.issubset(covered) and data.get('quality')!='blurred':break
        missing=sorted(required-covered)
        reason='local_blur' if data.get('quality')=='blurred' else 'missing_fields'
        # For blurred/missing lower rows, retry the body with more native pixels per request.
        if reason=='local_blur':target=(region[0],.25,region[2],1)
        event('vision.retry',page=page,reason=reason,missing=sorted(required-covered),attempt=attempt)
    return items


def extract_pdf_vision(filename: str):
    from .pdf_render import render_pages
    from .ocr_glm import OCRUnavailable
    trace=_active.get()
    with tempfile.TemporaryDirectory(prefix='zscore-vision-') as temp:
        directory=trace.directory if trace else Path(temp)
        pages=render_pages(filename,max_pages=None,dpi=250,out_dir=directory/'pages')
        items=[]
        for page_no,p in enumerate(pages):
            with Image.open(p) as src:image=src.convert('RGB')
            try:
                items+=extract_image(image,directory,page_no,str(Path(filename).resolve()))
            except Exception as exc:
                event('vision.page_failed',page=page_no,error=type(exc).__name__,message=str(exc)[:300])
        if not items:raise OCRUnavailable('没有取得具备期间、单位和坐标的有效识别结果；请查看分析日志或提供 Excel。')
        return items,ExtractMethod.GLM_OCR,sum(len(it.raw_value) for it in items)


def extract_image(image: Image.Image, directory: Path, page_no: int, filename: str):
    """One preparation path for PDF and embedded PPTX images; browser review calls this pipeline too."""
    meta=classify_page(image,directory,page_no)
    upright=image.rotate(-meta['rotation'],expand=True)
    upright.save(directory/f'page-{page_no}-upright.png')
    event('vision.prepared',page=page_no,rotation=meta['rotation'],kind=meta['kind'],size=upright.size)
    if meta['kind'] in ['OTHER','CF']:
        event('vision.not_required',page=page_no,kind=meta['kind'])
        return []
    regions=[(0,0,.525,1),(.475,0,1,1)] if meta['kind']=='BS' and meta.get('layout')=='two-column' else [(0,0,1,1)]
    items=[]
    for region in regions:
        if meta['kind']=='BS':
            groups=[(['流动资产合计','资产总计','非流动资产合计'],['current_assets','total_assets']),
                    (['流动负债合计','负债合计','非流动负债合计'],['current_liabilities','total_liabilities']),
                    (['所有者权益合计','盈余公积','未分配利润'],['equity_total'])]
            if len(regions)==2:groups=groups[:1] if region[0]==0 else groups[1:]
        else:
            groups=[(['营业收入','利润总额','利息费用'],['revenue','profit_before_tax']),(['净利润','所得税费用'],['net_profit'])]
        for targets,required in groups:
            context={**meta,'targets':targets,'required':required}
            items+=read_region(upright,region,context,page_no,directory,filename)
    return items
