import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

import { liveVideoFit } from '../../../apps/mobile/lib/live-video-fit.ts';

test('完整模式保留横竖屏四边，包括曾被自动裁掉上下的1280×572屏幕', () => {
  for (const [width, height, sourceWidth, sourceHeight] of [
    [1280, 572, 1920, 1080],
    [844, 390, 1920, 1080],
    [390, 844, 1920, 1080],
    [390, 844, 1080, 1920],
    [1280, 572, 640, 480],
  ]) {
    for (const mode of ['contain', 'auto', '']) {
      const fit = liveVideoFit(mode);
      const scale =
        fit === 'cover'
          ? Math.max(width / sourceWidth, height / sourceHeight)
          : Math.min(width / sourceWidth, height / sourceHeight);
      assert.ok(sourceWidth * scale <= width + 0.001);
      assert.ok(sourceHeight * scale <= height + 0.001);
      assert.ok(
        Math.abs(sourceWidth * scale - width) < 0.001 ||
          Math.abs(sourceHeight * scale - height) < 0.001,
      );
    }
  }
});
test('仅明确选择裁切铺满时使用cover，默认完整模式接入观看页', () => {
  assert.equal(liveVideoFit('cover'), 'cover');
  assert.equal(liveVideoFit('invalid'), 'contain');
  const watch = readFileSync(
    new URL('../../../apps/mobile/pages/live/watch.uvue', import.meta.url),
    'utf8',
  );
  assert.ok(watch.includes("videoSizing = ref('contain')"));
  assert.ok(watch.includes('liveVideoFit(videoSizing.value)'));
  assert.ok(watch.includes(':fit="videoFit"'));
});
const discussion = readFileSync(
  new URL('../../../apps/mobile/components/LiveDiscussion.uvue', import.meta.url),
  'utf8',
);
function chatSetup() {
  const context = vm.createContext({
    ref: (value) => ({ value }),
    props: { immersive: true, clean: false },
    items: { value: [{ id: 'one' }] },
    nextTick: (fn) => Promise.resolve(fn()),
  });
  const code = discussion.slice(
    discussion.indexOf('const chatAnchor ='),
    discussion.indexOf('function messageActions'),
  );
  vm.runInContext(
    stripTypeScriptTypes(code) + '\nglobalThis.chat={chatAnchor,chatScrolled,followLatest};',
    context,
  );
  return context;
}
test('新评论跟随到底部，往上阅读时保持位置，回到底部后继续跟随', () => {
  const s = chatSetup();
  s.chat.followLatest();
  assert.equal(s.chat.chatAnchor.value, 'live-message-one');
  s.chat.chatScrolled({ detail: { scrollTop: 100, scrollHeight: 600 } });
  s.items.value.push({ id: 'two' });
  s.chat.followLatest();
  assert.equal(s.chat.chatAnchor.value, 'live-message-one');
  s.chat.chatScrolled({ detail: { scrollTop: 444, scrollHeight: 600 } });
  s.chat.followLatest();
  assert.equal(s.chat.chatAnchor.value, 'live-message-two');
});
test('清屏不操作评论列表，恢复后定位最新消息', () => {
  const s = chatSetup();
  s.props.clean = true;
  s.chat.followLatest();
  assert.equal(s.chat.chatAnchor.value, '');
  s.props.clean = false;
  s.chat.followLatest();
  assert.equal(s.chat.chatAnchor.value, 'live-message-one');
});

const speedControl = readFileSync(
  new URL('../../../apps/mobile/components/VideoPlaybackControls.uvue', import.meta.url),
  'utf8',
);
test('视频内选择倍速只发出倍率变更，选完收起并跟随原生控件隐藏', () => {
  const changes = [],
    watches = [];
  const script = speedControl
    .match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '');
  const context = vm.createContext({
    ref: (v) => ({ value: v }),
    watch: (getter, fn) => watches.push(fn),
    withDefaults: (props, defaults) => Object.assign(props, { ...defaults, ...props }),
    defineProps: () => ({ value: 1, visible: true }),
    defineEmits: () => (event, value) => changes.push({ event, value }),
  });
  vm.runInContext(stripTypeScriptTypes(script) + '\nglobalThis.control={open,select};', context);
  context.control.open.value = true;
  context.control.select(1.5);
  assert.deepEqual(changes, [{ event: 'change', value: 1.5 }]);
  assert.equal(context.control.open.value, false);
  context.control.open.value = true;
  watches.at(-1)();
  assert.equal(context.control.open.value, false);
});
test('底栏播放暂停、拖动进度和全屏使用同一播放器，不重建媒体', () => {
  const calls = [],
    changes = [];
  const props = {
    playerId: 'lessonVideo',
    playing: false,
    position: 20,
    total: 20,
    fullscreen: false,
    visible: true,
    value: 1,
  };
  const script = speedControl
    .match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '');
  const context = vm.createContext({
    ref: (v) => ({ value: v }),
    watch: () => {},
    withDefaults: (props, defaults) => Object.assign(props, { ...defaults, ...props }),
    defineProps: () => props,
    defineEmits: () => (event, value) => changes.push({ event, value }),
    uni: {
      createVideoContext: (id) => {
        assert.equal(id, props.playerId);
        return {
          play: () => calls.push('play'),
          pause: () => calls.push('pause'),
          requestFullScreen: () => calls.push('enter'),
          exitFullScreen: () => calls.push('exit'),
        };
      },
    },
  });
  vm.runInContext(
    stripTypeScriptTypes(script) +
      '\nglobalThis.control={togglePlayback,toggleFullscreen,drag,seek,dragging,dragPosition};',
    context,
  );
  context.control.togglePlayback();
  assert.deepEqual(changes.shift(), { event: 'seek', value: 0 });
  props.playing = true;
  context.control.togglePlayback();
  context.control.toggleFullscreen();
  props.fullscreen = true;
  context.control.toggleFullscreen();
  assert.deepEqual(calls, ['play', 'pause', 'enter', 'exit']);
  context.control.drag({ detail: { value: 12 } });
  assert.equal(context.control.dragging.value, true);
  assert.equal(context.control.dragPosition.value, 12);
  context.control.seek({ detail: { value: 99 } });
  assert.deepEqual(changes.pop(), { event: 'seek', value: 20 });
  assert.equal(context.control.dragging.value, false);
});
