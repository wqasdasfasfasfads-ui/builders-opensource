// avatar.js - draws a tiny SVG "player icon" (blocky Minecraft-style character)
// from the character's 4 colors (head/torso/arms/legs). Used for small previews.

function avatarSvg(colors, size = 40, shirt = null) {
  const c = Object.assign(
    { head: "#f5cd30", torso: "#0d69ac", arms: "#f5cd30", legs: "#a2c429" },
    colors || {}
  );

  // Each shape carries an avatar-part--<role> class so pages that let the
  // player pick colors (see /avatar) can recolor the live preview in the
  // browser without redrawing the whole SVG.
  // Optional 2D shirt print: crops the front of the torso out of the
  // 585x559 template.
  let shirtSvg = "";
  if (shirt && shirt.dataUrl && shirt.layout) {
    const L = shirt.layout;
    const r = L.torso.front;
    shirtSvg = `<svg x="12" y="13" width="16" height="14" viewBox="${r[0]} ${r[1]} ${r[2]} ${r[3]}" preserveAspectRatio="none"><image href="${shirt.dataUrl}" width="${L.width}" height="${L.height}" style="image-rendering:pixelated"/></svg>`;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Character avatar" shape-rendering="crispEdges">
    <rect x="0" y="0" width="40" height="40" rx="6" fill="#11141a"/>
    <rect class="avatar-part avatar-part--legs" x="12" y="27" width="8" height="11" fill="${c.legs}"/>
    <rect class="avatar-part avatar-part--legs" x="20" y="27" width="8" height="11" fill="${c.legs}"/>
    <rect class="avatar-part avatar-part--arms" x="4" y="13" width="8" height="14" fill="${c.arms}"/>
    <rect class="avatar-part avatar-part--arms" x="28" y="13" width="8" height="14" fill="${c.arms}"/>
    <rect class="avatar-part avatar-part--torso" x="12" y="13" width="16" height="14" fill="${c.torso}"/>
    ${shirtSvg}
    <rect class="avatar-part avatar-part--head" x="14" y="2" width="12" height="11" fill="${c.head}"/>
    <rect x="17" y="5" width="2" height="3" fill="#15181d"/><rect x="21" y="5" width="2" height="3" fill="#15181d"/>
    <rect x="17" y="10" width="6" height="1" fill="#15181d"/>
  </svg>`;
}

module.exports = { avatarSvg };
