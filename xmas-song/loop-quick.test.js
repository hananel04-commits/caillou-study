// node xmas-song/loop.test.js — 반복/카운터 로직 시뮬레이션 테스트
const assert = require("assert");
const X = require("./loop-quick.js");
const LINES = require("./lines.json");

// 가짜 플레이어: 50ms마다 rate만큼 시간이 흐름
function sim({ start, end, target, rest = 1000, rate = 1, maxMs = 120000, onTick }) {
  const L = X.create({ restMs: rest });
  let now = 0, t = 0, playing = false, finished = false;
  const log = [];
  const apply = (acts) => acts.forEach((a) => {
    log.push({ now, ...a, count: L.state().count });
    if (a.type === "seek") t = a.t;
    if (a.type === "play") playing = true;
    if (a.type === "pause") playing = false;
    if (a.type === "finished") finished = true;
  });
  apply(L.begin(start, end, target, now));
  let maxT = 0;
  while (now < maxMs && !finished) {
    now += 50;
    if (playing) t += 0.05 * rate;
    if (L.state().mode === "loop") maxT = Math.max(maxT, t);
    if (onTick) onTick({ now, L, setT: (v) => (t = v), apply });
    apply(L.tick(t, now, playing));
  }
  return { L, log, finished, now, maxT, t };
}
let n = 0; const ok = (m) => { n++; console.log("✓ " + m); };

// 1) 3번 반복: seek 횟수, 카운터, 쉬는 시간
{
  const r = sim({ start: 10, end: 14, target: 3, rest: 1000 });
  assert.ok(r.finished);
  const rests = r.log.filter((a) => a.type === "rest");
  assert.strictEqual(rests.length, 2, "3번 반복이면 쉬는 시간 2번");
  assert.deepStrictEqual(rests.map((a) => a.count), [2, 3]);
  assert.strictEqual(r.L.state().count, 3);
  assert.strictEqual(X.counterText(3, 3), "3/3");
  // 끝 시간을 넘어서 0.1초 이상 재생되지 않음 (50ms 폴링)
  assert.ok(r.maxT <= 14 + 0.1, "끝을 지나침: " + r.maxT);
  // 총 시간 ≈ 4초×3 + 1초×2 (+ seek 안정 시간)
  assert.ok(r.now >= 14000 && r.now <= 15500, "총 시간 " + r.now);
  ok("3번 반복 + 쉬는 시간 1초 + 카운터 1/3→3/3");
}
// 2) 1번 반복은 쉬지 않고 끝남
{
  const r = sim({ start: 0, end: 2, target: 1 });
  assert.ok(r.finished); assert.strictEqual(r.log.filter((a) => a.type === "rest").length, 0);
  ok("1번 반복은 한 번 듣고 끝");
}
// 3) 쉬는 시간 없음: pause 없이 바로 seek
{
  const r = sim({ start: 5, end: 7, target: 5, rest: 0 });
  assert.ok(r.finished);
  assert.strictEqual(r.log.filter((a) => a.type === "pause").length, 1, "마지막에만 pause");
  assert.strictEqual(r.log.filter((a) => a.type === "seek").length, 1 + 4 + 1);
  ok("쉬는 시간 없음: 5번 연속 반복");
}
// 4) 0.5배속 10번
{
  const r = sim({ start: 20, end: 23, target: 10, rate: 0.5, rest: 1000 });
  assert.ok(r.finished); assert.strictEqual(r.L.state().count, 10);
  assert.ok(r.maxT <= 23 + 0.05);
  ok("0.5배속 10번 반복");
}
// 5) ∞ 반복은 끝나지 않고 카운터만 올라감
{
  const r = sim({ start: 0, end: 2, target: Infinity, maxMs: 60000 });
  assert.ok(!r.finished); assert.ok(r.L.state().count >= 15, "count=" + r.L.state().count);
  assert.strictEqual(X.counterText(7, Infinity), "7번째 (계속)");
  ok("∞ 반복: 60초 동안 " + r.L.state().count + "번");
}
// 6) seek 직후 옛 시간이 보고돼도(모바일 지연) 두 번 세지 않음
{
  const L = X.create({ restMs: 0 });
  L.begin(10, 12, 5, 0);
  let a = L.tick(12.0, 1000, true); // 끝 → seek, count 2
  assert.strictEqual(L.state().count, 2);
  a = L.tick(12.02, 1050, true);   // 아직 옛 위치 보고 → 무시해야 함
  assert.strictEqual(a.length, 0); assert.strictEqual(L.state().count, 2);
  ok("seek 직후 옛 currentTime은 무시 (중복 카운트 없음)");
}
// 7) 사용자가 막대를 멀리 옮기면 소절 처음으로 돌아옴
{
  const r = sim({ start: 30, end: 34, target: 2, onTick: ({ now, setT }) => { if (now === 2000) setT(80); } });
  assert.ok(r.finished);
  assert.ok(r.log.some((a) => a.type === "seek" && a.t === 30 && a.now === 2000));
  ok("다른 곳으로 이동하면 소절 시작으로 복귀");
}
// 8) 영상이 멈춘 상태(모바일 오버레이 등)에서는 카운트가 오르지 않음
{
  const L = X.create({ restMs: 0 });
  L.begin(0, 2, 3, 0);
  for (let now = 500; now < 5000; now += 50) L.tick(2.5, now, false);
  assert.strictEqual(L.state().count, 1);
  ok("일시정지 중에는 반복 횟수가 그대로");
}
// 9) 반복 중에 횟수를 줄이면 이번이 마지막
{
  const L = X.create({ restMs: 0 });
  L.begin(0, 2, 10, 0); L.tick(2, 1000, true); L.tick(2, 2000, true); L.tick(2, 3000, true);
  assert.strictEqual(L.state().count, 4);
  L.setTarget(3); assert.strictEqual(L.state().count, 3);
  const a = L.tick(2, 4000, true); assert.ok(a.some((x) => x.type === "finished"));
  ok("반복 중 횟수 변경");
}
// 10) 2소절 묶어 반복: 앞 소절 시작 ~ 뒤 소절 끝
{
  const s = LINES[2].s, e = LINES[3].e;
  const r = sim({ start: s, end: e, target: 3 });
  assert.ok(r.finished); assert.ok(r.maxT <= e + 0.1 && r.maxT >= e - 0.1);
  ok(`2소절 묶음(3~4번, ${s}~${e}초) 3번 반복`);
}
// 11) 가사 데이터 점검 + lineAt
{
  assert.ok(LINES.length > 20);
  LINES.forEach((L, i) => {
    assert.ok(L.e > L.s, "끝>시작 " + i);
    assert.ok(L.e - L.s >= 1.5 && L.e - L.s <= 10, "길이 " + i + " " + (L.e - L.s));
    if (i) assert.ok(L.s >= LINES[i - 1].e - 0.001, "겹침 " + i);
  });
  assert.strictEqual(X.lineAt(LINES, 0), -1);
  LINES.forEach((L, i) => assert.strictEqual(X.lineAt(LINES, (L.s + L.e) / 2), i));
  ok("가사 " + LINES.length + "소절: 시간 순서·겹침 없음·lineAt");
}
console.log(`\n모두 통과: ${n}개 테스트`);
