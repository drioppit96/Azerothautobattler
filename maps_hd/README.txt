High resolution maps
====================

Put high resolution zone maps in this folder to draw them over the normal maps.

- Use the same file names as in the "maps" folder (for example "Durotar.png").
  png, jpg and webp all work ("Durotar.jpg" is fine too).
- The picture must show the same area as the normal map (any size, same shape).
  If it shows more (for example the whole 1024x768 frame with borders), add
  hd_maps.json here with the part that matches the normal map:
      { "Durotar": { "crop": [0, 0, 2004, 1336] } }
  (x, y, width, height in pixels of the HD picture)
- Switch between HD and normal maps with the "HD map" checkbox at the top.
  Zones without an HD picture keep the normal map.
