"use strict";

function normalizedRectangle(start, point) {
  return { left: Math.min(start.x, point.x), right: Math.max(start.x, point.x), top: Math.min(start.y, point.y), bottom: Math.max(start.y, point.y) };
}

function intersects(left, right) {
  return left.right >= right.left && right.right >= left.left && left.bottom >= right.top && right.bottom >= left.top;
}

module.exports = { intersects, normalizedRectangle };
