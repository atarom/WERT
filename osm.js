export function osmViewUrl(item) {
  return `https://www.openstreetmap.org/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`;
}
export function osmEditUrl(item) {
  const param = encodeURIComponent(item.type);
  return `https://www.openstreetmap.org/edit?editor=id&${param}=${encodeURIComponent(item.id)}`;
}
