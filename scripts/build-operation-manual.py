#!/usr/bin/env python3
"""Build the one deliverable operation manual from verified records and real screenshots.

Run with the bundled Python runtime described in --help. The input and screenshots
are local evidence and are never fetched from the production service by this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / ".local/operation-samples/manual-data.json"
DEFAULT_OUT = ROOT / "output/pdf/一网统飞平台-业务闭环操作手册.pdf"
FONT = "/Library/Fonts/Arial Unicode.ttf"
HEADING_FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
W, H = landscape(A4)
M = 38
INK = colors.HexColor("#173047")
NAVY = colors.HexColor("#102B44")
BLUE = colors.HexColor("#2478C9")
TEAL = colors.HexColor("#167F8B")
MUTED = colors.HexColor("#617789")
LINE = colors.HexColor("#D9E4EC")
PALE = colors.HexColor("#F1F6FA")
WHITE = colors.white
STATUS = {
    "DRAFT": "草稿", "PENDING_REVIEW": "待审核", "APPROVED": "已通过",
    "RETURNED": "需补正", "PENDING_ASSIGNMENT": "待分配",
    "PENDING_EXECUTION": "待执行", "EXECUTING": "执行中",
    "PENDING_ACCEPTANCE": "待验收", "COMPLETED": "已完成",
    "PENDING_DISPOSAL": "待处置", "ARCHIVED": "已归档", "CANCELLED": "已取消",
}


def field(record, *names, default=""):
    for name in names:
        value = record.get(name)
        if value is not None and value != "":
            return value
    return default


def time_window(record):
    values = []
    for key in ("startAt", "endAt"):
        raw = record.get(key)
        if not raw:
            return "时段以平台登记为准"
        value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
        values.append(value.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%m-%d %H:%M"))
    return " 至 ".join(values)+"（上海时间）"


def records(data, name):
    value = data.get(name, data.get("records", {}).get(name, []))
    if isinstance(value, dict):
        value = value.get("items", [dict(v, alias=k) for k, v in value.items()
                                    if isinstance(v, dict)])
    result = []
    for index, item in enumerate(value):
        record = dict(item.get("record", item))
        for key in ("alias", "key", "code"):
            if key in item and key not in record:
                record[key] = item[key]
        record["alias"] = str(field(record, "alias", "code", "key",
                                    default=f"{name[0].upper()}{index + 1}"))
        result.append(record)
    return result


@dataclass
class Evidence:
    data: dict
    base: Path
    plans: list
    tasks: list
    cases: list
    shots: dict

    @classmethod
    def read(cls, source):
        data = json.loads(source.read_text())
        shots = data.get("screenshots", {})
        for external_shots in (source.parent / "screenshots.json",
                               source.parent / "screenshots/screenshots.json"):
            if not shots and external_shots.is_file():
                shots = json.loads(external_shots.read_text())
                shots = shots.get("screenshots", shots)
        if isinstance(shots, list):
            shots = {Path(s if isinstance(s, str) else s["path"]).stem: s for s in shots}
        return cls(data, source.parent, records(data, "plans"),
                   records(data, "tasks"), records(data, "cases"), shots)

    def get(self, alias):
        for item in self.plans + self.tasks + self.cases:
            if item["alias"].upper() == alias.upper():
                return item
        raise ValueError(f"Missing verified record {alias}")

    def alias_for(self, record_id):
        return next((r["alias"] for r in self.plans+self.tasks+self.cases
                     if r.get("id") == record_id), "")

    def shot(self, key):
        value = self.shots.get(key) or self.shots.get(SHOT_ALIASES.get(key, ""))
        if not value:
            raise ValueError(f"Missing real screenshot key: {key}")
        item = {"path": value} if isinstance(value, str) else dict(value)
        path = Path(item.get("path", item.get("file", "")))
        if not path.is_absolute():
            local = self.base / path
            nested = self.base / "screenshots" / path
            path = local if local.is_file() else nested if nested.is_file() else ROOT / path
        if not path.is_file():
            raise ValueError(f"Screenshot does not exist: {path}")
        item["path"] = path
        return item

    def validate(self):
        if (len(self.plans), len(self.tasks), len(self.cases)) != (6, 9, 6):
            raise ValueError("Expected the verified 6 plans, 9 tasks and 6 cases")
        plan, task, case = self.get("P3"), self.get("T8"), self.get("C5")
        if plan.get("status") != "APPROVED" or plan.get("kind") != "LONG_TERM":
            raise ValueError("P3 must be the approved long-term plan")
        if task.get("status") != "COMPLETED" or case.get("status") != "ARCHIVED":
            raise ValueError("T8/C5 have not reached verified final states")
        if task.get("planId") != plan.get("id") or case.get("taskId") != task.get("id"):
            raise ValueError("P3 -> T8 -> C5 association is not verified")
        if any(r.get("region") != "余杭区" for r in (plan, task, case)):
            raise ValueError("The main example must remain in 余杭区")
        for key in SHOT_KEYS:
            self.shot(key)


SHOT_KEYS = ("plan_application", "plan_approved", "task_arrange", "task_assignment",
             "task_execution", "task_finish", "task_acceptance", "task_completed",
             "case_register", "case_review", "case_disposal", "case_archived")
SHOT_ALIASES = {
    "plan_application": "plan-application-modal", "plan_approved": "plan-approved",
    "task_arrange": "plan-arrange-modal", "task_assignment": "task-assignment-modal",
    "task_execution": "task-start-modal", "task_completed": "task-completed",
    "task_finish": "task-finish-modal", "task_acceptance": "task-acceptance",
    "case_register": "case-register-modal", "case_archived": "case-archived",
    "case_review": "case-review-modal", "case_disposal": "case-disposal-modal",
}


class Manual:
    def __init__(self, evidence, output):
        self.e = evidence
        self.output = output
        output.parent.mkdir(parents=True, exist_ok=True)
        pdfmetrics.registerFont(TTFont("CJK", FONT))
        pdfmetrics.registerFont(TTFont("HeitiMedium", HEADING_FONT, subfontIndex=0))
        self.c = canvas.Canvas(str(output), pagesize=(W, H), pageCompression=1)
        self.c.setTitle("一网统飞平台 | 业务闭环操作手册")
        self.c.setAuthor("一网统飞平台")
        self.c.setSubject("飞行服务、任务调度与场景应用的管理员操作演练")
        self.page = 0
        self.assets = []
        self.overflows = []

    def rect(self, x, top, width, height, fill=WHITE, stroke=None, radius=8):
        self.c.setFillColor(fill)
        self.c.setStrokeColor(stroke or fill)
        self.c.roundRect(x, H-top-height, width, height, radius,
                         stroke=bool(stroke), fill=True)

    def line(self, x1, top1, x2, top2, color=LINE, width=0.7):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(width)
        self.c.line(x1, H-top1, x2, H-top2)

    def text(self, content, x, top, width, size=10, color=INK, leading=None,
             max_height=None):
        style = ParagraphStyle("body", fontName="HeitiMedium" if size >= 11 else "CJK", fontSize=size,
                               leading=leading or size*1.65, textColor=color,
                               alignment=TA_LEFT, wordWrap="CJK", spaceAfter=0)
        paragraph = Paragraph(escape(str(content)).replace("\n", "<br/>"), style)
        _, height = paragraph.wrap(width, H)
        if max_height is not None and height > max_height+0.5:
            self.overflows.append((self.page, str(content)[:40], height, max_height))
        paragraph.drawOn(self.c, x, H-top-height)
        return height

    def label(self, content, x, top, color=TEAL):
        return self.text(content, x, top, W-2*M, 8.5, color, 12)

    def page_start(self, section, title, subtitle=""):
        if self.page:
            self.c.showPage()
        self.page += 1
        self.c.bookmarkPage(f"page-{self.page}")
        self.c.addOutlineEntry(f"{self.page:02d}  {title}", f"page-{self.page}", level=0)
        self.c.setFillColor(WHITE)
        self.c.rect(0, 0, W, H, fill=True, stroke=False)
        self.rect(0, 0, 7, H, BLUE, radius=0)
        self.label(f"ONEFLIGHT  /  {section}", M, 23)
        self.text(title, M, 45, W-2*M, 23, NAVY, 29)
        if subtitle:
            self.text(subtitle, M, 82, W-2*M, 9.5, MUTED, 15)
        self.line(M, H-36, W-M, H-36)
        self.text("一网统飞平台 · 业务操作演练", M, H-27,
                  W-2*M-90, 7.2, MUTED, 10)
        self.text(f"{self.page:02d}  /  12", W-M-52, H-27, 55, 8, MUTED, 10)

    def section(self, number, heading, body, x, top, width=235):
        self.rect(x, top+2, 22, 22, BLUE, radius=5)
        self.text(str(number), x+6, top+3, 17, 11, WHITE, 15)
        self.text(heading, x+32, top, width-32, 12, NAVY, 19)
        h = self.text(body, x+32, top+28, width-32, 9.2, MUTED, 15.1)
        return max(57, h+41)

    def note(self, title, body, x, top, width, height=70):
        self.rect(x, top, width, height, PALE, radius=7)
        self.text(title, x+12, top+9, width-24, 9.5, TEAL, 14)
        self.text(body, x+12, top+28, width-24, 8.7, MUTED, 14,
                  max_height=height-35)

    def screenshot(self, key, x, top, width, height, caption, focus=None):
        shot = self.e.shot(key)
        path = shot["path"]
        with Image.open(path) as source:
            img = source.convert("RGB")
            crop = shot.get("crop")
            if not crop and focus == "header":
                crop = (0, 0, img.width, min(img.height, 402))
            if crop:
                img = img.crop(tuple(crop))
            image_width, image_height = img.size
            self.rect(x, top, width, height, PALE, LINE, radius=7)
            scale = min((width-12)/image_width, (height-12)/image_height)
            dest_w, dest_h = image_width*scale, image_height*scale
            from reportlab.lib.utils import ImageReader
            self.c.drawImage(ImageReader(img), x+(width-dest_w)/2,
                             H-top-(height+dest_h)/2, width=dest_w, height=dest_h)
        self.text(caption, x+2, top+height+7, width-4, 8, MUTED, 12)
        self.assets.append({"page": self.page, "key": key, "path": str(path),
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                            "crop": crop})

    def workflow_page(self, section, title, subtitle, shot, caption, steps, note):
        self.page_start(section, title, subtitle)
        self.screenshot(shot, M, 115, 500, 295, caption)
        y = 114
        for i, (heading, body) in enumerate(steps, 1):
            y += self.section(i, heading, body, 560, y, W-560-M)
        self.note(note[0], note[1], M, 447, 500, 88)

    def gallery_page(self, section, title, subtitle, primary, secondary, steps, note):
        self.page_start(section, title, subtitle)
        self.screenshot(primary[0], M, 115, 500, 217, primary[1])
        for i, item in enumerate(secondary):
            self.screenshot(item[0], M+i*256, 366, 244, 149, item[1],
                            focus=item[2] if len(item) > 2 else None)
        y = 114
        for i, (heading, body) in enumerate(steps, 1):
            y += self.section(i, heading, body, 560, y, W-560-M)
        self.note(note[0], note[1], 560, 441, W-560-M, 98)

    def cover(self):
        self.page_start("OPERATION MANUAL", "业务闭环操作手册", "飞行服务 / 任务调度 / 场景应用")
        self.rect(M, 116, W-2*M, 162, NAVY, radius=12)
        self.text("从一份计划，到一条可追溯的办理记录", M+24, 136, W-2*M-48,
                  21, WHITE, 30)
        self.text("以余杭区林缘样区 A 为例，按当前页面完成计划核验、资源分配、任务验收和线索归档。",
                  M+24, 181, W-2*M-48, 11, colors.HexColor("#CEE4F4"), 18)
        self.text("管理员全程演练版  |  2026.10.16", M+24, 240, 500, 10,
                  colors.HexColor("#91BDDD"), 16)
        stages = [("01", "计划核验", "飞行服务"), ("02", "分配与执行", "任务调度"),
                  ("03", "成果与验收", "任务调度"), ("04", "复核与归档", "场景应用")]
        for i, (num, title, page) in enumerate(stages):
            x = M+i*196
            self.rect(x, 302, 177, 82, PALE, radius=8)
            self.label(num, x+13, 313)
            self.text(title, x+13, 334, 150, 12, NAVY, 18)
            self.text(page, x+13, 359, 150, 8.5, MUTED, 13)
            if i < 3:
                self.text(">", x+182, 335, 14, 11, BLUE, 15)
        self.text("本手册使用生产平台中的业务演练记录。设备档案和来源目录按实际读取展示；计划、任务、线索状态用于演示本地流程，不代表真实飞行、监管审批、火情确认或执法结果。截图选用同批不同阶段样例，主闭环核对 P3、T8、C5。",
                  M, 410, W-2*M, 9.5, INK, 16)
        self.text("岗位分工：需求部门提报与验收；调度核验、分配和跟踪；飞手登记本人任务进度并提交成果；管理员可全程操作。3 个受限演练岗位不表示实名资质。复现时另建任务与线索，T8、C5 供结果核对。",
                  M, 477, W-2*M, 8.5, MUTED, 14)
        self.text("访问地址  http://47.96.225.165:8088    使用已提供的管理员账号登录，再从左侧菜单进入对应模块。", M, 523, W-2*M, 9, TEAL, 14)
        self.c.linkURL("http://47.96.225.165:8088", (M, H-541, M+300, H-519),
                       relative=0, thickness=0)

    def index(self):
        self.page_start("01 / SAMPLE INDEX", "实际样例索引", "编号仅供本手册定位；平台内请按实际名称检索。主案例使用 P3 → T8 → C5。")
        groups = [("6 份计划", self.e.plans), ("9 张任务单", self.e.tasks),
                  ("6 条行业线索", self.e.cases)]
        width, gap = (W-2*M-24)/3, 12
        for group, (title, values) in enumerate(groups):
            x = M+group*(width+gap)
            self.rect(x, 115, width, 32, NAVY, radius=6)
            self.text(title, x+12, 122, width-24, 11, WHITE, 17)
            row_h = 42 if len(values) > 6 else 60
            for index, item in enumerate(values):
                y = 154+index*row_h
                is_main = item["alias"] in ("P3", "T8", "C5")
                self.rect(x, y, width, row_h-4, PALE if is_main else WHITE,
                          LINE, radius=5)
                status = STATUS.get(item.get("status"), item.get("status", ""))
                if item in self.e.cases and item.get("status") == "PENDING_REVIEW":
                    status = "待复核"
                related = self.e.alias_for(item.get("planId") or item.get("taskId"))
                reference = f" · {related}" if related else ""
                self.text(f'{item["alias"]}  {status}{reference}', x+9, y+5, width-18,
                          8, TEAL if is_main else MUTED, 11)
                self.text(field(item, "title", "name"), x+9, y+19, width-18,
                          8.7, INK, 12.8, max_height=row_h-23)
                if is_main:
                    target = {"P3": 4, "T8": 8, "C5": 10}[item["alias"]]
                    self.c.linkRect("", f"page-{target}",
                                    (x, H-y-row_h+4, x+width, H-y), thickness=0)

    def roles(self):
        self.page_start("02 / BEFORE YOU START", "先核对角色、范围与关联", "管理员可按本手册连续操作；日常办理仍按岗位职责分别执行。")
        roles = [
            ("需求部门", "提报需求 / 安排已批计划任务 / 验收成果 / 办理行业线索"),
            ("运营调度", "核验计划 / 分配设备与飞手 / 登记执行进度 / 办理行业线索"),
            ("执行飞手", "查看本人获派任务和关联计划 / 登记开始执行 / 上传并提交成果"),
            ("管理员", "在授权范围内完成本手册全流程，检查来源信息和办理履历"),
        ]
        for i, (title, desc) in enumerate(roles):
            y = 117+i*68
            self.rect(M, y, 480, 59, PALE, radius=6)
            self.text(title, M+14, y+10, 100, 11, NAVY, 17)
            self.text(desc, M+111, y+11, 350, 9.3, MUTED, 15)
        x = 550
        for n, title, body in [
            (1, "同一业务范围", "计划、任务属于同一组织和余杭区；任务作业时段完整包含在计划时段内。"),
            (2, "可分配的资源", "设备档案已完善调度资料；飞手账号启用、具备区域与设备授权，且双方无时段冲突。"),
            (3, "三条记录各自办理", "P3 审批结果由 T8 沿用；C5 通过来源任务关联 T8，任务完成不自动归档线索。"),
        ]:
            self.section(n, title, body, x, 117+(n-1)*111, W-x-M)
        self.note("本地演练岗位", "3 个受限岗位用于操作演练，不能视为实名飞手资质。登录凭据单独保管，本手册不包含密码。",
                  M, 437, W-2*M, 92)

    def plan_apply(self):
        plan = self.e.get("P3")
        height = f'{plan["height"]} 米' if plan.get("height") is not None else "未填写"
        self.workflow_page("02 / FLIGHT SERVICE", "提交飞行计划申请", "入口：飞行服务 → 飞行计划申请", "plan_application",
            "实际页面：申请名称、类型、区域、时段和范围说明是本次演练的核对重点。", [
            ("填写基本信息", "申请类型选择日常计划或长期计划；申请部门与适用区域使用后续任务相同的组织和余杭区。"),
            ("填写覆盖时段", "完整填写开始、结束时间。为同一计划下的多次任务预留足够时段；每张任务必须在此范围内。"),
            ("提交申请", "填写飞行范围 / 材料说明，点“提交申请”。申请进入待审核，等待运营调度核验。"),
        ], ("本轮 P3 的实际填单值", f"长期计划；{plan.get('region', '余杭区')}；申请高度 {height}。高度是内部申请参数，并非实际飞行高度。证照与外部回执按真实材料登记。"))

    def plan_approve(self):
        plan = self.e.get("P3")
        self.workflow_page("03 / PLAN REVIEW", "核验通过，再安排执行任务", f'主案例计划 P3：{plan["title"]}', "plan_approved",
            "实际页面：P3 核验完成，当前办理区域可安排执行任务。", [
            ("核对待审核申请", "检查名称、区域、有效期和范围说明。材料不足时点“退回补正”，由申请人编辑后重新提交。"),
            ("登记核验意见", "材料齐全后点“核验通过”，填写办理说明并确认。批准结果可由覆盖时段内的多次任务沿用。"),
            ("安排本次任务", "已通过的日常或长期计划显示“安排执行任务”；设备准入和人员准入不生成执行任务。"),
        ], ("P3 实际有效期", f"{time_window(plan)}。T8 关联原计划 P3；此处核验是平台内办理，不等同外部监管放行。"))

    def arrange(self):
        task = self.e.get("T8")
        self.workflow_page("04 / ARRANGE TASK", "从原计划创建一张任务单", f'任务 T8：{task["title"]}', "task_arrange",
            "实际页面：“安排执行任务”表单自动继承所属计划、需求部门和作业区域。", [
            ("填写本次作业", "输入任务名称，应用场景选“森林防火”，紧急程度选“常规”，补齐作业要求。"),
            ("核对一次作业时段", "填写作业开始、结束时间，两者完整包含在 P3 有效期内。不同次作业分别建立任务。"),
            ("进入调度", "点“创建并进入任务调度”。新任务直接为待分配，沿用原计划审批结果，不重复审批。"),
        ], ("T8 实际作业时段", f"{time_window(task)}。T8 已关联已批 P3；复现时从此入口安排新任务。也可先提报需求，再关联匹配计划。"))

    def assignment(self):
        self.workflow_page("05 / ASSIGN RESOURCES", "分配执行设备与飞手", "操作路径：待分配任务 → 分配资源；截图使用 T2，T8 已完成", "task_assignment",
            "同批 T2 的分配弹窗：用于说明待分配阶段的字段；T8 当前已完成。", [
            ("先选执行设备", "弹窗标题为“分配执行资源”。从可分配设备中选择执行设备，核对档案和调度状态。"),
            ("再选执行飞手", "选择具有本设备授权、任务区域权限且本时段可用的飞手。不可选条目会显示具体原因。"),
            ("保留原关联计划", "T2 沿用 P1；主案例 T8 沿用 P3。核对后点“分配执行资源”，进入待执行。复现用新任务，避开排班冲突。"),
        ], ("遇到暂无可用资源", "按页面提示完善设备调度资料或飞手权限，调整冲突时段，再点“重新检查可用范围”。不要靠换账号绕过检查。"))

    def execution(self):
        self.workflow_page("06 / RECORD PROGRESS", "登记开始，查看设备运行", "操作路径：待执行任务 → 登记开始执行；截图使用 T4，T8 已完成", "task_execution",
            "同批 T4 的登记开始弹窗：用于说明待执行阶段；T8 当前已完成。", [
            ("检查开始条件", "本次任务已分配资源，关联计划已通过且组织、区域、时段匹配。计划缺失、未批或读取失败时先处理提示。"),
            ("登记本地进度", "点“登记开始执行”，核对提示并填写办理说明，确认后任务进入执行中。"),
            ("查看设备运行", "从任务点“查看设备运行”，核对所分配设备的来源观测和飞行记录。页面作业按钮不发送物理设备指令。"),
        ], ("观察数据的含义", "来源观测、历史飞行与本任务的办理状态分别核对。指挥大屏的本地报告机队不作为 T8 真实飞行证据。"))

    def acceptance(self):
        self.gallery_page("07 / RESULTS & ACCEPTANCE", "提交成果，办理验收", "操作路径：执行中任务 → 提交成果 → 验收；T8 仅作为已完成结果核对",
            ("task_finish", "T6：资料核对任务的提交成果弹窗；本次截图未提交。"),
            [("task_acceptance", "T7：资料核对待验收，可通过或退回。"),
             ("task_completed", "T8：已完成结果（详情顶部）。", "header")], [
            ("先补充成果材料", "在“成果与证据”点“上传文件”，上传本次演练核对表。点“提交成果”，填写必填“成果说明”。"),
            ("进入待验收", "提交后进入待验收。需求部门或管理员核对成果、附件和关联任务信息，再点“验收通过”。"),
            ("需要补充时退回", "待验收点“退回完善”并填办理说明，任务回到执行中。补资料后再次提交成果，最后验收。"),
        ], ("材料先上传", "按实际完成的演练内容验收。已完成或已取消任务附件只读；最终验收前补齐所需材料。"))

    def case_register(self):
        self.workflow_page("08 / REGISTER CASE", "登记与任务关联的行业线索", "入口：场景应用 → 工作内容：森林防火 → 登记线索", "case_register",
            "实际页面：填写线索名称、所属区域、来源任务和线索说明。", [
            ("选择正确工作内容", "场景应用提供森林防火、矿产监管、非现执法。本案例选森林防火；所属区域与 T8 均为余杭区。"),
            ("绑定本次来源任务", "主案例的来源任务为 T8“林缘样区A巡查闭环”。复现时选择本次新任务；线索经任务关联计划，不另填计划编号。"),
            ("登记后核对", "点“登记线索”进入待复核。在“证据研判”核对关联任务、线索说明，再补充对应演练材料。"),
        ], ("时间与材料", "页面“发现时间”展示登记时间。原始观测时间如未核实，应在线索说明中写清；不要将登记时间解释为已核实拍摄时间。"))

    def archive(self):
        self.gallery_page("09 / REVIEW & ARCHIVE", "人工复核，登记处置并归档", "操作路径：待复核 → 待处置 → 已归档；C5 仅作为归档结果核对",
            ("case_archived", "C5：已归档结果，来源任务、最终结论与材料留存。"),
            [("case_review", "C1：复核通过弹窗，未提交。"),
             ("case_disposal", "C3：登记处置并归档，未提交。")], [
            ("复核材料", "待复核线索点“复核通过”，填写必填“人工结论 / 处置结果”，确认后进入待处置。截图用 C1 演示。"),
            ("登记处置结果", "在待处置阶段点“登记处置并归档”，写明本次演练材料核对与处理结果，确认后直接已归档。"),
            ("回查归档记录", "将“事项状态”切到“已归档”，搜索 C5 名称，核对关联任务、最终结论、附件与办理履历。"),
        ], ("直接归档", "登记处置后直接已归档，无需再点“完成归档”。C3 为矿产监管示例，按钮流程相同。"))

    def branches(self):
        self.page_start("10 / EXCEPTIONS", "遇到退回或无效材料，按分支办理", "先看当前状态，再选择对应按钮；所有意见保存在办理履历。")
        cards = [
            ("计划材料不完整", "待审核 → 退回补正 → 需补正", "申请人点“编辑申请”，保存修改后“重新提交”；回到待审核，再由调度核验。"),
            ("需求范围需要补充", "待分配 → 退回完善 → 需补正", "填写退回原因；需求方点“编辑需求”，保存修改后“重新提交”，回到待分配。"),
            ("成果需要补充", "待验收 → 退回完善 → 执行中", "执行人员补充成果说明和附件，再点“提交成果”；需求部门重新核对并验收。"),
            ("线索没有有效依据", "待复核 → 认定无效并归档 → 已归档", "弹窗标题“无效线索归档”。填写人工结论，例如材料不足、无法核实；不补造现场结论。"),
        ]
        cw = (W-2*M-18)/2
        for i, (heading, path, body) in enumerate(cards):
            x, y = M+(i%2)*(cw+18), 116+(i//2)*168
            self.rect(x, y, cw, 150, PALE, LINE, radius=8)
            self.text(heading, x+16, y+14, cw-32, 13, NAVY, 20)
            self.text(path, x+16, y+47, cw-32, 10, TEAL, 17)
            self.text(body, x+16, y+80, cw-32, 9.4, MUTED, 16)
        self.text("矿产监管与非现执法沿用同一线索流程；选择相应工作内容，关联本场景任务，并按材料内容填写人工结论。",
                  M, 473, W-2*M, 10, INK, 17)

    def final_check(self):
        self.page_start("11 / CLOSE THE LOOP", "闭环核查：确认计划、任务与线索对应", "主案例最终状态以本轮实际登记与验收结果为准。")
        columns = [("P3 / 已通过", self.e.get("P3"), "组织、区域和有效期覆盖 T8；办理履历保留提交、核验记录。"),
                   ("T8 / 已完成", self.e.get("T8"), "关联原计划 P3；成果说明、附件和开始、提交、验收履历完整。"),
                   ("C5 / 已归档", self.e.get("C5"), "来源任务指向 T8；复核与处置结论留存，可在已归档中查到。")]
        cw = (W-2*M-24)/3
        for i, (heading, record, desc) in enumerate(columns):
            x = M+i*(cw+12)
            self.rect(x, 117, cw, 193, PALE, LINE, radius=8)
            self.text(heading, x+14, 132, cw-28, 13, TEAL, 20)
            self.text(record["title"], x+14, 168, cw-28, 11, NAVY, 17)
            self.text(desc, x+14, 223, cw-28, 9.5, MUTED, 16)
        checks = ["能按样例索引检索到 6 份计划、9 张任务单、6 条线索。",
                  "已逐项核对 P3 → T8 → C5 的实际关联，未只凭相似标题判断。",
                  "需补正、待办理和归档示例保持各自阶段，没有把所有样例都强行办结。",
                  "演练说明、资料出处和未知信息清楚；未登记虚构外部回执或真实飞行结论。",
                  "已保存演练核对材料，能在办理履历中追溯实际操作者和时间。"]
        for i, body in enumerate(checks):
            y = 332+i*33
            self.rect(M+2, y+4, 11, 11, WHITE, TEAL, radius=2)
            self.text(body, M+25, y, W-2*M-25, 10, INK, 17)
        self.text("复跑时另建本次任务与线索；不要改写已归档记录，也不要复用原任务冒充新的执行。",
                  M, 514, W-2*M, 8.5, MUTED, 13)

    def build(self):
        for method in (self.cover, self.index, self.plan_apply, self.plan_approve,
                       self.arrange, self.assignment, self.execution, self.acceptance,
                       self.case_register, self.archive, self.branches, self.final_check):
            method()
        if self.page != 12:
            raise ValueError(f"Expected 12 pages, got {self.page}")
        self.c.save()
        return {"pages": self.page, "assets": self.assets,
                "overflows": self.overflows, "output": str(self.output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    if not args.data.is_file():
        parser.error(f"Verified data is not ready: {args.data}")
    evidence = Evidence.read(args.data)
    evidence.validate()
    manual = Manual(evidence, args.output)
    report = manual.build()
    report["inputSha256"] = hashlib.sha256(args.data.read_bytes()).hexdigest()
    report_path = ROOT / "tmp/pdfs/manual-build-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if report["overflows"]:
        raise SystemExit(f"Text overflow: {report['overflows']}")
    print(json.dumps({"output": str(args.output), "pages": report["pages"],
                      "report": str(report_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
