// node xmas-song/loop.test.js — 반복/카운터/준비(prep) 로직 시뮬레이션 테스트
const assert = require("assert");
const X = require("./loop.js");
const LINES = require("./lines.json");

// 가짜 플레이어: 50ms마다 rate만큼 시간이 흐름. 화면이 보이는(소리 켜진) 구간을 기록
function sim({ start, end, target, speed = 1, maxMs = 180000, onTick, buffering = 0 }) {
  const L = X.create({ speed });
  let now = 0, t = 0, playing = false, finished = false, rate = 1, muted = false, stallUntil = 0;
  const log = [], audible = [];
  const apply = (acts) => acts.forEach((a) => {
    log.push({ now, t, ...a, count: L.state().count, mode: L.state().mode });
    if (a.type === "seek") { t = a.t; stallUntil = now + buffering; }
    if (a.type === "play") playing = true;
    if (a.type === "pause") playing = false;
    if (a.type === "rate") rate = a.r;
    if (a.type === "mute") muted = true;
    if (a.type === "unmute") muted = false;
    if (a.type === "finished") finished = true;
  });
  apply(L.begin(start, end, target, now, speed));
  let maxT = 0;
  while (now < maxMs && !finished) {
    now += 50;
    const stalled = now < stallUntil;
    if (playing && !stalled) t += 0.05 * rate;
    if (playing && !muted) { audible.push(t); maxT = Math.max(maxT, t); }
    if (onTick) onTick({ now, L, setT: (v) => (t = v), apply });
    apply(L.tick(t, now, playing && !stalled));
  }
  return { L, log, finished, now, maxT, t, audible };
}
let n = 0; const ok = (m) => { n++; console.log("✓ " + m); };
const types = (log, ty) => log.filter((a) => a.type === ty);

// 1) 3번 반복: 카운터, 소리는 소절 안에서만, 멈춤(pause)은 마지막 한 번
{
  const r = sim({ start: 10, end: 14, target: 3 });
  assert.ok(r.finished);
  assert.strictEqual(r.L.state().count, 3);
  assert.deepStrictEqual(types(r.log, "rest").map((a) => a.count), [2, 3]);
  assert.strictEqual(types(r.log, "go").length, 3, "소리 켜기 3번");
  assert.strictEqual(types(r.log, "pause").length, 1, "pause는 끝날 때 한 번뿐 (반복 사이에 일시정지 화면 없음)");
  assert.ok(r.audible.every((t) => t >= 10 - 0.06 && t <= 14 + 0.1), "소리는 소절 안에서만");
  assert.ok(r.maxT <= 14 + 0.1, "끝을 지나침: " + r.maxT);
  assert.strictEqual(X.counterText(3, 3), "3/3");
  // 준비 4.8초 + 소절 4초 = 회당 약 8.8초
  assert.ok(r.now >= 3 * 8.8 * 1000 - 600 && r.now <= 3 * 8.8 * 1000 + 1500, "총 시간 " + r.now);
  ok("3번 반복: 카운터 1/3→3/3, 반복 사이 pause 없음, 소리는 소절 안에서만");
}
// 2) 준비 시간: 소리를 켜기 전에 최소 PREROLL_SEC 동안 재생(가림막 뒤)
{
  const r = sim({ start: 30, end: 33, target: 2 });
  const seeks = types(r.log, "seek"), gos = types(r.log, "go");
  seeks.forEach((s, i) => assert.ok(gos[i].now - s.now >= X.PREROLL_SEC * 1000 - 100, "준비 " + (gos[i].now - s.now)));
  assert.strictEqual(seeks[0].t, 30 - X.PREROLL_SEC);
  ok("소리 켜기 전 준비 " + X.PREROLL_SEC + "초 (유튜브 버튼이 사라질 시간)");
}
// 3) 첫 소절처럼 앞이 짧으면 느린 속도로 준비
{
  const pr = X.preroll(LINES[0].s, 1);
  assert.ok(pr.from >= 0 && pr.rate < 1 && (LINES[0].s - pr.from) / pr.rate >= X.PREROLL_SEC - 0.01, JSON.stringify(pr));
  const r = sim({ start: LINES[0].s, end: LINES[0].e, target: 2 });
  assert.ok(r.finished);
  assert.ok(types(r.log, "rate").some((a) => a.r === 1), "소리 켤 때 원래 속도로");
  ok(`1번 소절(시작 ${LINES[0].s}초): ${pr.from}초부터 ${pr.rate}배로 준비`);
}
// 4) 0.5배속 10번
{
  const r = sim({ start: 20, end: 23, target: 10, speed: 0.5 });
  assert.ok(r.finished); assert.strictEqual(r.L.state().count, 10);
  assert.ok(r.maxT <= 23 + 0.05);
  assert.ok(types(r.log, "rate").filter((a) => a.mode === "loop").every((a) => a.r === 0.5));
  ok("0.5배속 10번 반복");
}
// 5) ∞ 반복은 끝나지 않고 카운터만 올라감
{
  const r = sim({ start: 40, end: 42, target: Infinity, maxMs: 70000 });
  assert.ok(!r.finished); assert.ok(r.L.state().count >= 9, "count=" + r.L.state().count);
  assert.strictEqual(X.counterText(7, Infinity), "7번째 (계속)");
  ok("∞ 반복: 70초 동안 " + r.L.state().count + "번");
}
// 6) seek 직후 옛 currentTime이 보고돼도(모바일 지연) 두 번 세지 않음
{
  const L = X.create({});
  L.begin(10, 12, 5, 0, 1);
  L.tick(10, 5000, true);                 // 준비 끝 → loop
  assert.strictEqual(L.state().mode, "loop");
  L.tick(12.0, 7000, true);               // 끝 → 다시 준비, count 2
  assert.strictEqual(L.state().count, 2); assert.strictEqual(L.state().mode, "prep");
  const a = L.tick(12.02, 7050, true);    // 아직 옛 위치 → 무시
  assert.strictEqual(a.length, 0); assert.strictEqual(L.state().count, 2);
  ok("seek 직후 옛 currentTime은 무시 (중복 카운트 없음)");
}
// 7) 위치가 엉뚱하게 바뀌면 소절 처음으로 돌아옴
{
  const r = sim({ start: 30, end: 34, target: 2, onTick: ({ now, setT }) => { if (now === 6500) setT(80); } });
  assert.ok(r.finished);
  assert.ok(r.log.some((a) => a.type === "seek" && a.now === 6500));
  ok("다른 곳으로 이동하면 다시 준비 → 소절 시작");
}
// 8) 영상이 멈춘 상태(버퍼링·자동재생 차단)에서는 카운트·소리 켜기 없음
{
  const L = X.create({});
  L.begin(5, 7, 3, 0, 1);
  for (let now = 500; now < 9000; now += 50) assert.strictEqual(L.tick(5.2, now, false).length, 0);
  assert.strictEqual(L.state().count, 1); assert.strictEqual(L.state().mode, "prep");
  ok("멈춰 있는 동안엔 그대로 기다림");
}
// 9) 버퍼링이 길어도 소리는 소절 시작부터
{
  const r = sim({ start: 50, end: 53, target: 2, buffering: 1500 });
  assert.ok(r.finished);
  assert.ok(r.audible.every((t) => t >= 50 - 0.06 && t <= 53 + 0.1));
  ok("버퍼링 1.5초가 있어도 정확히 반복");
}
// 10) 반복 중에 횟수를 줄이면 이번이 마지막
{
  const L = X.create({});
  L.begin(10, 12, 10, 0, 1);
  L.tick(10, 5000, true); L.tick(12, 7000, true); L.tick(10, 12000, true); L.tick(12, 14000, true);
  assert.strictEqual(L.state().count, 3);
  L.setTarget(2); assert.strictEqual(L.state().count, 2);
  L.tick(10, 19000, true);
  const a = L.tick(12, 21000, true); assert.ok(a.some((x) => x.type === "finished"));
  ok("반복 중 횟수 변경");
}
// 11) 2소절 묶어 반복 + 전체 듣기 + 멈추기
{
  const s = LINES[2].s, e = LINES[3].e;
  const r = sim({ start: s, end: e, target: 3 });
  assert.ok(r.finished); assert.ok(r.maxT <= e + 0.1 && r.maxT >= e - 0.1);
  const L = X.create({});
  const a = L.playAll(LINES[0].s, 0, 1);
  assert.ok(a.some((x) => x.type === "mute") && a.some((x) => x.type === "seek"));
  L.tick(LINES[0].s, 6000, true); assert.strictEqual(L.state().mode, "all");
  assert.deepStrictEqual(L.stop().map((x) => x.type), ["mute", "pause"]);
  assert.deepStrictEqual(L.stop(), []);
  ok(`2소절 묶음(3~4번, ${s}~${e}초) 3번 반복 · 전체 듣기 · 멈추기`);
}
// 12) 가사 데이터 점검 + lineAt + 모든 소절의 준비 위치
{
  assert.ok(LINES.length > 20);
  LINES.forEach((L, i) => {
    assert.ok(L.e > L.s, "끝>시작 " + i);
    assert.ok(L.e - L.s >= 1.5 && L.e - L.s <= 10, "길이 " + i + " " + (L.e - L.s));
    if (i) assert.ok(L.s >= LINES[i - 1].e - 0.001, "겹침 " + i);
    [0.5, 0.75, 1].forEach((sp) => { const p = X.preroll(L.s, sp); assert.ok(p.from >= 0 && (L.s - p.from) / p.rate >= X.PREROLL_SEC - 0.02, i + " " + sp); });
  });
  assert.strictEqual(X.lineAt(LINES, 0), -1);
  LINES.forEach((L, i) => assert.strictEqual(X.lineAt(LINES, (L.s + L.e) / 2), i));
  ok("가사 " + LINES.length + "소절: 시간 순서·겹침 없음·lineAt·준비 위치");
}
console.log(`\n모두 통과: ${n}개 테스트`);
