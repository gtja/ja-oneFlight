export interface RequestTemplate {
  scene: string;
  summary: string;
  targetHint: string;
  focus: string;
  deliverables: string;
}

export const requestTemplates: RequestTemplate[] = [
  {
    scene: "森林防火",
    summary: "核查林区烟火、重点点位与火险线索",
    targetHint: "例如：某林区、山体或重点防火点位的名称与具体位置",
    focus: "巡查烟雾、明火及重点防火点位，记录异常位置和现场情况。",
    deliverables:
      "提供巡查照片、异常点位及情况说明；未发现异常时记录巡查范围。",
  },
  {
    scene: "矿产监管",
    summary: "核查矿区边界、开采活动与堆放情况",
    targetHint: "例如：矿区、采场或疑似开采点的名称与具体位置",
    focus: "核查开采范围、现场作业及堆放情况，记录疑似异常线索。",
    deliverables: "提供现场照片、重点位置和核查说明，保留后续人工核实依据。",
  },
  {
    scene: "河道巡查",
    summary: "查看河段水面、岸线与排口情况",
    targetHint: "例如：河道名称、起止河段、桥梁或排口位置",
    focus: "巡查水面漂浮物、岸线堆放及排口情况，记录异常位置和现场特征。",
    deliverables: "提供河段巡查照片、异常点位及情况说明。",
  },
  {
    scene: "非现执法",
    summary: "采集指定点位与时段的现场线索",
    targetHint: "例如：待核查点位、道路或建筑的名称与具体位置",
    focus: "按指定点位和时段采集现场情况，记录线索时间、位置及关键特征。",
    deliverables: "提供带时间与位置说明的现场照片及线索说明，供人工核实。",
  },
];

export function requestDescription(
  target: string,
  focus: string,
  deliverables: string,
) {
  return `作业对象与位置：${target.trim()}\n\n检查重点：${focus.trim()}\n\n成果要求：${deliverables.trim()}`;
}
