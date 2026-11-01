'use strict';

function hallNodeExperience(node, mapId, campaignState) {
  const campaignId = Number(campaignState.MAP_TO_CAMPAIGN[Number(mapId)] || mapId);
  const campaign = campaignState.campaignById.get(campaignId);
  if (Number(campaign?.Capacity) !== 3 || Number(campaign?.SonTypes) !== 0) return null;
  return Math.max(0, Number(node?.HeroGP) || 0);
}

module.exports = { hallNodeExperience };
