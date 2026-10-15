// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+). The fields arrive
// resolved (scene variables substituted) and validated by the core; a thrown
// error fails this action only, the scene goes on.
//
// The power, the volume and the source are device features: the core's own
// "control a device" action already sets them. These two actions do what a
// feature cannot: play a preset by number whatever the select shows, and play
// an address.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  /** Play one of the six presets: outputs the name of what it plays. */
  async play_preset(hub, { fields }) {
    const preset = await hub.playPreset(fields.device, fields.preset);
    return { preset_name: preset.name ?? `${preset.id}` };
  },

  /**
   * Play an http:// address (a radio stream, a sound file served on the
   * local network) through the speaker's UPnP renderer, at an optional
   * volume.
   */
  async play_url(hub, { fields }) {
    await hub.playUrl(fields.device, fields.url, fields.volume);
  },
};
