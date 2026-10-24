/* 소절 반복 엔진 (YouTube와 분리된 순수 로직: 브라우저와 Node 테스트에서 함께 사용)
 *
 * 휴대폰용 유튜브 플레이어는 재생을 시작하거나 위치를 옮길(seek) 때마다 약 4초 동안
 * 제목·재생 버튼·공유 버튼을 화면에 띄웁니다. 그래서 매번 이렇게 합니다:
 *   ① 준비(prep): 소리를 끄고, 가림막(정지 사진)으로 덮은 채, 소절 시작보다 조금 앞에서 재생
 *   ② 버튼이 사라질 만큼 시간이 지나고 소절 시작에 닿으면 → 소리를 켜고 가림막을 걷음(loop)
 *   ③ 소절 끝 → 다시 ① (멈추지 않으므로 '일시정지' 화면도 생기지 않음)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XmasLoop = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var END_EPS = 0.04;        // 끝 시간 조금 전이면 끝난 것으로 봄 (50ms 폴링 보정)
  var SEEK_SETTLE_MS = 400;  // seek 직후 getCurrentTime이 옛 값을 돌려줄 수 있어 잠깐 무시
  var PREROLL_SEC = 4.8;     // 준비 시간(실제 초). 유튜브 버튼이 사라지는 시간(약 4초)보다 길게
  var RATES = [0.25, 0.5, 0.75, 1];

  // 소절 시작 start 앞에서 PREROLL_SEC 동안 재생할 수 있는 위치와 속도를 고름
  function preroll(start, speed, prerollSec) {
    var p = prerollSec == null ? PREROLL_SEC : prerollSec;
    var cands = RATES.filter(function (r) { return r <= speed + 1e-9; }).reverse();
    if (!cands.length) cands = [RATES[0]];
    for (var i = 0; i < cands.length; i++) {
      var from = start - p * cands[i];
      if (from >= 0) return { from: Math.round(from * 100) / 100, rate: cands[i] };
    }
    return { from: 0, rate: RATES[0] };
  }

  function create(opts) {
    opts = opts || {};
    var s = {
      mode: "idle",        // idle | prep | loop | all | done   (prep: 준비 중, all: 전체 듣기)
      next: "loop",        // prep이 끝나면 갈 모드 (loop 또는 all)
      start: 0, end: 0, from: 0, preRate: 1,
      speed: opts.speed || 1,
      prerollSec: opts.prerollSec == null ? PREROLL_SEC : opts.prerollSec,
      target: 1,           // 반복 횟수 (Infinity 가능)
      count: 0,            // 지금 몇 번째 듣는 중인지 (1부터)
      settleUntil: 0
    };
    function prepActions(now) {
      var pr = preroll(s.start, s.speed, s.prerollSec);
      s.from = pr.from; s.preRate = pr.rate; s.mode = "prep"; s.settleUntil = now + SEEK_SETTLE_MS;
      return [{ type: "mute" }, { type: "rate", r: pr.rate }, { type: "seek", t: pr.from }, { type: "play" }];
    }
    function begin(start, end, target, now, speed) {
      if (speed) s.speed = speed;
      s.start = start; s.end = end; s.target = target; s.count = 1; s.next = "loop";
      return prepActions(now);
    }
    function playAll(start, now, speed) {
      if (speed) s.speed = speed;
      s.start = start; s.end = Infinity; s.count = 0; s.next = "all";
      return prepActions(now);
    }
    function stop() {
      var was = s.mode; s.mode = "idle";
      return was === "idle" || was === "done" ? [] : [{ type: "mute" }, { type: "pause" }];
    }
    function setSpeed(v) { s.speed = v; return (s.mode === "loop" || s.mode === "all") ? [{ type: "rate", r: v }] : []; }
    function setTarget(n) {
      s.target = n;
      if (s.count > n) s.count = n; // 이미 목표보다 많이 들었으면 이번 회차가 마지막
    }
    // 준비가 끝나 소리를 켤 차례인지 남은 시간(실제 초) — 화면 카운트다운용
    function prepLeft(t) { return s.mode === "prep" ? Math.max(0, (s.start - t) / s.preRate) : 0; }
    // t: 현재 재생 위치(초), now: 현재 시각(ms), playing: 실제로 재생 중인지
    function tick(t, now, playing) {
      var a = [];
      if (s.mode === "prep") {
        if (now < s.settleUntil || !playing) return a;
        if (t >= s.start - END_EPS) {
          s.mode = s.next; s.settleUntil = now;
          a.push({ type: "rate", r: s.speed }, { type: "unmute" }, { type: "go" });
        } else if (t < s.from - 1.5 || t > s.start + 1.5) {
          a = prepActions(now); // 엉뚱한 곳이면 다시 준비
        }
        return a;
      }
      if (s.mode !== "loop") return a;
      if (now < s.settleUntil || !playing) return a;
      if (t >= s.end - END_EPS) {
        if (s.count >= s.target) {
          s.mode = "done";
          a.push({ type: "mute" }, { type: "pause" }, { type: "finished" });
        } else {
          s.count += 1;
          a = prepActions(now);
          a.push({ type: "rest" });
        }
      } else if (t < s.start - 1.5 || t > s.end + 1.5) {
        a = prepActions(now); // 위치가 엉뚱하면 소절 처음부터 다시
      }
      return a;
    }
    function state() { return s; }
    return { begin: begin, playAll: playAll, stop: stop, tick: tick, setSpeed: setSpeed, setTarget: setTarget, prepLeft: prepLeft, state: state };
  }

  // 시간 t에 해당하는 소절 번호(0부터). 간주 중이면 바로 앞 소절, 노래 시작 전이면 -1
  function lineAt(lines, t) {
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (t >= lines[i].s - 0.05) idx = i; else break;
    }
    return idx;
  }

  function counterText(count, target) {
    if (target === Infinity) return count + "번째 (계속)";
    return count + "/" + target;
  }

  return { create: create, preroll: preroll, lineAt: lineAt, counterText: counterText, END_EPS: END_EPS, SEEK_SETTLE_MS: SEEK_SETTLE_MS, PREROLL_SEC: PREROLL_SEC };
});
