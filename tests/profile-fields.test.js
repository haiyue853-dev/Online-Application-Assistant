const test = require("node:test");
const assert = require("node:assert/strict");

const profileApi = require("../profile-fields.js");
const helpers = require("../ai-helpers.js");

test("normalizeProfile drops blanks and empty members, keeps pending custom fields once", () => {
  const profile = profileApi.normalizeProfile({
    values: { name: " 张三 ", usedName: "   " },
    family: [
      { relation: "父亲", name: "张父" },
      { relation: "表哥", name: "张表" },
      { relation: "母亲", name: "" }
    ],
    custom: [
      { key: "是否有亲属在本行", value: "" },
      { key: "是否有亲属在本行 ", value: "否" },
      { key: "  ", value: "x" }
    ]
  });

  assert.deepEqual(profile.values, { name: "张三" });
  assert.deepEqual(profile.family.map((member) => [member.relation, member.name]), [["父亲", "张父"], ["其他亲属", "张表"]]);
  assert.deepEqual(profile.custom, [{ key: "是否有亲属在本行", value: "否" }], "the filled duplicate wins over the empty one");
  assert.deepEqual(profileApi.normalizeProfile(null), profileApi.emptyProfile());
});

test("profile fields: presets, numbered repeat relations, filled custom fields only", () => {
  const fields = profileApi.profileToResumeFields({
    values: { name: "张三", nativeProvince: "河南省" },
    family: [
      { relation: "父亲", name: "张父", company: "某公司" },
      { relation: "兄弟姐妹", name: "张一" },
      { relation: "兄弟姐妹", name: "张二" }
    ],
    custom: [{ key: "英语口语", value: "流利" }, { key: "待补字段", value: "" }]
  });

  assert.deepEqual(fields, [
    { group: "基本信息", key: "姓名", value: "张三" },
    { group: "户籍与地区", key: "籍贯省", value: "河南省" },
    { group: "家庭主要成员", key: "父亲关系", value: "父亲" },
    { group: "家庭主要成员", key: "父亲姓名", value: "张父" },
    { group: "家庭主要成员", key: "父亲工作单位", value: "某公司" },
    { group: "家庭主要成员", key: "兄弟姐妹1关系", value: "兄弟姐妹" },
    { group: "家庭主要成员", key: "兄弟姐妹1姓名", value: "张一" },
    { group: "家庭主要成员", key: "兄弟姐妹2关系", value: "兄弟姐妹" },
    { group: "家庭主要成员", key: "兄弟姐妹2姓名", value: "张二" },
    { group: "补充字段", key: "英语口语", value: "流利" }
  ]);
  assert.equal(profileApi.countPendingFields({ custom: [{ key: "待补字段", value: "" }] }), 1);
});

test("profile includes overview, internship and project fields for one-click filling", () => {
  const fields = profileApi.profileToResumeFields({
    values: { identity: "2027 届硕士应届毕业生", summary: "关注用户体验", highlights: "跨团队推进能力强" },
    internships: [{ company: "星河科技", role: "产品实习生", period: "2025.06 - 2025.09", description: "负责需求分析" }],
    projects: [{ name: "网申助手", role: "负责人", period: "2025.01 - 至今", description: "浏览器扩展" }]
  });

  assert.deepEqual(fields, [
    { group: "个人概况", key: "身份", value: "2027 届硕士应届毕业生" },
    { group: "个人概况", key: "简介", value: "关注用户体验" },
    { group: "个人概况", key: "亮点", value: "跨团队推进能力强" },
    { group: "实习经历", key: "实习1公司", value: "星河科技" },
    { group: "实习经历", key: "实习1岗位", value: "产品实习生" },
    { group: "实习经历", key: "实习1起止时间", value: "2025.06 - 2025.09" },
    { group: "实习经历", key: "实习1职责", value: "负责需求分析" },
    { group: "项目经历", key: "项目1名称", value: "网申助手" },
    { group: "项目经历", key: "项目1角色", value: "负责人" },
    { group: "项目经历", key: "项目1时间", value: "2025.01 - 至今" },
    { group: "项目经历", key: "项目1描述", value: "浏览器扩展" }
  ]);
});

test("parsed resume fields sync overview, internships and projects into 我的信息", () => {
  const profile = profileApi.mergeResumeFieldsIntoProfile(
    { values: { identity: "本机身份" }, internships: [], projects: [] },
    [
      { group: "个人概况", key: "个人简介", value: "数据产品方向" },
      { group: "个人概况", key: "身份", value: "解析身份" },
      { group: "实习经历", key: "实习1公司", value: "星河科技" },
      { group: "实习经历", key: "实习1岗位", value: "产品实习生" },
      { group: "项目经历", key: "项目1名称", value: "网申助手" },
      { group: "项目经历", key: "项目1项目描述", value: "自动填写扩展" }
    ]
  );

  assert.equal(profile.values.identity, "本机身份", "already saved profile content wins");
  assert.equal(profile.values.summary, "数据产品方向");
  assert.deepEqual(profile.internships.map((record) => [record.company, record.role]), [["星河科技", "产品实习生"]]);
  assert.deepEqual(profile.projects.map((record) => [record.name, record.description]), [["网申助手", "自动填写扩展"]]);
});

test("semanticized parsed fields also sync into 我的信息", () => {
  const profile = profileApi.profileFromResumeFields([
    { group: "实习经历", key: "星河科技实习经历-公司", value: "星河科技" },
    { group: "实习经历", key: "星河科技实习经历-岗位", value: "产品实习生" },
    { group: "项目经历", key: "网申助手项目经历-名称", value: "网申助手" },
    { group: "项目经历", key: "网申助手项目经历-描述", value: "自动填写扩展" },
    { group: "项目经历", key: "网申助手项目经历-成果", value: "减少重复录入" }
  ]);

  assert.deepEqual(profile.internships.map((record) => [record.company, record.role]), [["星河科技", "产品实习生"]]);
  assert.deepEqual(profile.projects.map((record) => [record.name, record.description, record.achievements]), [
    ["网申助手", "自动填写扩展", "减少重复录入"]
  ]);
});

test("我的信息中的修改值优先用于自动填表", () => {
  const merged = profileApi.mergeResumeFields(
    [{ group: "基本信息", key: "姓名", value: "模板里的名字" }],
    [{ group: "基本信息", key: "姓名", value: "档案里的名字" }, { group: "基本信息", key: "民族", value: "汉族" }]
  );

  assert.deepEqual(merged.map((field) => field.value), ["档案里的名字", "汉族"]);
});

test("解析出的教育等非预置字段会带原分组显示在我的信息并参与填表", () => {
  const profile = profileApi.profileFromResumeFields([
    { group: "教育背景", key: "学校", value: "某某大学" },
    { group: "教育背景", key: "专业", value: "计算机科学与技术" },
    { group: "技能", key: "技能特长", value: "Python、Java、SQL" }
  ]);

  assert.equal(profile.values.skills, "Python、Java、SQL");
  assert.deepEqual(profile.custom, [
    { group: "教育背景", key: "学校", value: "某某大学" },
    { group: "教育背景", key: "专业", value: "计算机科学与技术" }
  ]);
  assert.deepEqual(profileApi.profileToResumeFields(profile), [
    { group: "语言与技能", key: "技能特长", value: "Python、Java、SQL" },
    { group: "教育背景", key: "学校", value: "某某大学" },
    { group: "教育背景", key: "专业", value: "计算机科学与技术" }
  ]);
});

test("多条被纠正的技能都会保留在我的信息", () => {
  const profile = profileApi.profileFromResumeFields([
    { group: "技能", key: "技能特长", value: "Python" },
    { group: "技能", key: "技能特长 (2)", value: "Java、SQL" }
  ]);

  assert.equal(profile.values.skills, "Python\nJava、SQL");
});

test("unanswered labels skip matched, filled, secret, file and known fields", () => {
  const known = profileApi.knownFieldKeys({ custom: [{ key: "已加过的字段", value: "" }] }, [{ key: "毕业院校" }]);
  const labels = profileApi.pickUnansweredLabels([
    { label: "是否有亲属在本行工作", inputType: "select" },
    { label: "是否有亲属在本行工作", inputType: "select" },
    { label: "姓名", inputType: "text", matched: true },
    { label: "兴趣爱好", inputType: "text", hasValue: true },
    { label: "登录密码", inputType: "text" },
    { label: "短信验证码", inputType: "text" },
    { label: "本人照片", inputType: "file" },
    { label: "我已阅读并同意", inputType: "checkbox" },
    { label: "身高（厘米）", inputType: "text" },
    { label: "已加过的字段", inputType: "text" },
    { label: "毕业院校", inputType: "text" },
    { label: "问", inputType: "text" },
    { label: "这是一个非常非常非常非常非常非常非常非常非常长的说明文字字段标签内容", inputType: "textarea" },
    { label: "职业规划", inputType: "textarea" }
  ], known);

  assert.deepEqual(labels, ["是否有亲属在本行工作", "职业规划"]);
  assert.equal(profileApi.pickUnansweredLabels(
    Array.from({ length: 30 }, (_, index) => ({ label: `字段${index}`, inputType: "text" })),
    new Set()
  ).length, 20);
});

test("adding pending fields skips what the profile already has", () => {
  const { profile, added } = profileApi.addPendingFields(
    { values: { name: "张三" }, custom: [{ key: "英语口语", value: "流利" }] },
    ["是否服从调剂", "英语口语", "职业规划", "职业规划"]
  );

  assert.equal(added, 1, "是否服从调剂 is a preset, 英语口语 exists, 职业规划 once");
  assert.deepEqual(profile.custom, [{ key: "英语口语", value: "流利" }, { key: "职业规划", value: "" }]);
  assert.equal(profile.values.name, "张三");
});

test("password-like custom fields and duplicates of presets never reach the AI field pool", () => {
  const fields = profileApi.profileToResumeFields({
    values: { phone: "13800000000" },
    custom: [
      { key: "网银登录密码", value: "hunter2" },
      { key: "备注", value: "网银密码：hunter3" },
      { key: "手机号码", value: "13900000000" },
      { key: "英语口语", value: "流利" }
    ]
  });

  assert.deepEqual(fields.map((field) => [field.key, field.value]), [["手机号码", "13800000000"], ["英语口语", "流利"]]);
});

test("known fields cover preset aliases and blank items of members already in the profile", () => {
  const known = profileApi.knownFieldKeys({ family: [{ relation: "父亲", name: "张父" }] }, []);
  const labels = profileApi.pickUnansweredLabels(
    ["手机号", "邮箱", "父亲联系电话", "父亲工作单位", "母亲工作单位"].map((label) => ({ label, inputType: "text" })),
    known
  );

  assert.deepEqual(labels, ["母亲工作单位"]);
});

test("adding pending fields skips password-like labels and says when the list is full", () => {
  assert.equal(profileApi.addPendingFields({}, ["查询密码"]).added, 0);

  const full = { custom: Array.from({ length: 200 }, (_, index) => ({ key: `字段${index}`, value: "" })) };
  const result = profileApi.addPendingFields(full, ["职业规划"]);
  assert.equal(result.added, 0);
  assert.equal(result.full, true);

  assert.equal(profileApi.addPendingFields({}, ["毕业院校"], [{ key: "毕业院校" }]).added, 0, "template fields count as known");
});

test("form entries round-trip into a profile", () => {
  const profile = profileApi.profileFromEntries([
    { kind: "value", field: "name", value: "张三" },
    { kind: "family", row: "3", field: "relation", value: "母亲" },
    { kind: "family", row: "3", field: "name", value: "李母" },
    { kind: "family", row: "4", field: "relation", value: "父亲" },
    { kind: "internships", row: "5", field: "company", value: "星河科技" },
    { kind: "internships", row: "5", field: "role", value: "产品实习生" },
    { kind: "projects", row: "6", field: "name", value: "网申助手" },
    { kind: "custom", row: "7", field: "key", value: "英语口语" },
    { kind: "custom", row: "7", field: "value", value: "流利" }
  ]);

  assert.deepEqual(profile.values, { name: "张三" });
  assert.deepEqual(profile.family.map((member) => [member.relation, member.name]), [["母亲", "李母"]]);
  assert.deepEqual(profile.internships.map((record) => [record.company, record.role]), [["星河科技", "产品实习生"]]);
  assert.deepEqual(profile.projects.map((record) => record.name), ["网申助手"]);
  assert.deepEqual(profile.custom, [{ key: "英语口语", value: "流利" }]);
});

test("merging a backup keeps what this machine already filled in", () => {
  const merged = profileApi.mergeProfiles(
    {
      values: { name: "本机" },
      family: [{ relation: "父亲", name: "本机父亲" }, { relation: "兄弟姐妹", name: "张一" }],
      custom: [{ key: "英语口语", value: "" }]
    },
    {
      values: { name: "备份", ethnicity: "汉族" },
      family: [
        { relation: "父亲", name: "备份父亲", company: "某公司" },
        { relation: "母亲", name: "备份母亲" },
        { relation: "兄弟姐妹", name: "张一", phone: "13900000000" },
        { relation: "兄弟姐妹", name: "张二" }
      ],
      custom: [{ key: "英语口语", value: "流利" }, { key: "职业规划", value: "银行" }]
    }
  );

  assert.deepEqual(merged.values, { name: "本机", ethnicity: "汉族" });
  assert.deepEqual(
    merged.family.map((member) => [member.relation, member.name, member.company, member.phone]),
    [
      ["父亲", "本机父亲", "某公司", ""],
      ["兄弟姐妹", "张一", "", "13900000000"],
      ["母亲", "备份母亲", "", ""],
      ["兄弟姐妹", "张二", "", ""]
    ],
    "members are merged one by one, filling only what this machine left blank"
  );
  assert.deepEqual(merged.custom, [{ key: "英语口语", value: "流利" }, { key: "职业规划", value: "银行" }]);
});

test("rules: profile region keys fill the right level and topic", () => {
  const resumeFields = profileApi.profileToResumeFields({
    values: { nativeProvince: "河南省", nativeCity: "南阳市", hukouCounty: "南召县", examProvince: "湖北省" }
  });
  const byId = new Map(helpers.buildRuleBasedMatches([
    { fieldId: "np", label: "籍贯", placeholder: "请选择省", inputType: "select", options: ["河南省"] },
    { fieldId: "nc", label: "籍贯", placeholder: "请选择市", inputType: "select", options: ["南阳市"] },
    { fieldId: "hk", label: "户口所在地", placeholder: "请选择区县", inputType: "select", options: ["南召县"] },
    { fieldId: "ex", label: "生源地", placeholder: "请选择省", inputType: "select", options: ["湖北省"] }
  ], resumeFields).map((match) => [match.fieldId, match.value]));

  assert.equal(byId.get("np"), "河南省");
  assert.equal(byId.get("nc"), "南阳市");
  assert.equal(byId.get("hk"), "南召县");
  assert.equal(byId.get("ex"), "湖北省");
});

test("rules: family and emergency contact data never fill the applicant's own fields", () => {
  const resumeFields = profileApi.profileToResumeFields({
    values: { emergencyName: "王五", emergencyPhone: "13700000000" },
    family: [{ relation: "兄弟姐妹", name: "张一", phone: "13900000000" }, { relation: "父亲", name: "张父" }]
  });
  const byId = new Map(helpers.buildRuleBasedMatches([
    { fieldId: "own-name", label: "姓名", inputType: "text", options: [] },
    { fieldId: "own-phone", label: "手机号码", inputType: "text", options: [] },
    { fieldId: "father", label: "姓名", group: "父亲", inputType: "text", options: [] },
    { fieldId: "emg-phone", label: "紧急联系人电话", inputType: "text", options: [] }
  ], resumeFields).map((match) => [match.fieldId, match.value]));

  assert.equal(byId.has("own-name"), false);
  assert.equal(byId.has("own-phone"), false);
  assert.equal(byId.get("father"), "张父");
  assert.equal(byId.get("emg-phone"), "13700000000");
});
