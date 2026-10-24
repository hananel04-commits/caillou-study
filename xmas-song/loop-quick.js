/* 소절 반복 엔진 (YouTube와 분리된 순수 로직: 브라우저와 Node 테스트에서 함께 사용) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.XmasLoopQuick = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var END_EPS = 0.04;      // 끝 시간 조금 전이면 끝난 것으로 봄 (50ms 폴링 보정)
  var SEEK_SETTLE_MS = 400; // seek 직후 getCurrentTime이 옛 값을 돌려줄 수 있어 잠깐 무시

  function create(opts) {
    opts = opts || {};
    var s = {
      mode: "idle",        // idle | loop | all | rest | done
      start: 0, end: 0,
      target: 1,           // 반복 횟수 (Infinity 가능)
      count: 0,            // 지금 몇 번째 듣는 중인지 (1부터)
      restMs: opts.restMs == null ? 1000 : opts.restMs,
      restUntil: 0,
      settleUntil: 0
    };
    function begin(start, end, target, now) {
      s.mode = "loop"; s.start = start; s.end = end;
      s.target = target; s.count = 1; s.settleUntil = now + SEEK_SETTLE_MS;
      return [{ type: "seek", t: start }, { type: "play" }];
    }
    function playAll(now) {
      s.mode = "all"; s.count = 0; s.settleUntil = now + SEEK_SETTLE_MS;
      return [{ type: "seek", t: 0 }, { type: "play" }];
    }
    function stop() {
      var was = s.mode; s.mode = "idle";
      return was === "idle" ? [] : [{ type: "pause" }];
    }
    function setRest(ms) { s.restMs = Math.max(0, ms | 0); }
    function setTarget(n) {
      s.target = n;
      // 이미 목표보다 많이 들었으면 이번 회차가 마지막
      if (s.count > n) s.count = n;
    }
    // t: 현재 재생 위치(초), now: 현재 시각(ms), playing: 실제로 재생 중인지
    function tick(t, now, playing) {
      var a = [];
      if (s.mode === "rest") {
        if (now >= s.restUntil) {
          s.mode = "loop"; s.settleUntil = now + SEEK_SETTLE_MS;
          a.push({ type: "seek", t: s.start }, { type: "play" });
        }
        return a;
      }
      if (s.mode !== "loop") return a;
      if (now < s.settleUntil || !playing) return a;
      if (t >= s.end - END_EPS) {
        if (s.count >= s.target) {
          s.mode = "done";
          a.push({ type: "pause" }, { type: "seek", t: s.start }, { type: "finished" });
        } else {
          s.count += 1;
          if (s.restMs > 0) {
            s.mode = "rest"; s.restUntil = now + s.restMs;
            a.push({ type: "pause" }, { type: "seek", t: s.start }, { type: "rest", ms: s.restMs });
          } else {
            s.settleUntil = now + SEEK_SETTLE_MS;
            a.push({ type: "seek", t: s.start });
          }
        }
      } else if (t < s.start - 1.5 || t > s.end + 1.5) {
        // 사용자가 영상 막대를 다른 곳으로 옮겼을 때: 소절 처음으로 되돌림
        s.settleUntil = now + SEEK_SETTLE_MS;
        a.push({ type: "seek", t: s.start });
      }
      return a;
    }
    function state() { return s; }
    return { begin: begin, playAll: playAll, stop: stop, tick: tick, setRest: setRest, setTarget: setTarget, state: state };
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

  return { create: create, lineAt: lineAt, counterText: counterText, END_EPS: END_EPS, SEEK_SETTLE_MS: SEEK_SETTLE_MS };
});
