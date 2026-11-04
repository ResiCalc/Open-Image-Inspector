
Open Image Inspector is a lightweight browser-based utility for reviewing image file details. It reports file size and format, reads dimensions from supported file headers, and checks selected EXIF, XMP, IPTC, and text markers in JPEG, PNG, and WebP files. Use it to quickly review supported image properties before sharing or organizing files.

Online tools:
- Image information: https://imagepixelconverter.com/en/image-checker/
- EXIF inspection: https://imagepixelconverter.com/en/exif-viewer/

The marker scan is limited to selected file formats and metadata indicators. It does not display individual EXIF field values or modify images. Formats without a supported scan are reported as unknown.


## Online References

- [Image information checker](https://imagepixelconverter.com/en/image-checker/)
- [EXIF viewer](https://imagepixelconverter.com/en/exif-viewer/)

## Local Development

Requires Node.js 18 or later.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```bash
npm run build
npm run preview
```

## Features and Limitations

- Reports file size and detected format.
- Reads dimensions from PNG, GIF, BMP, JPEG, and extended WebP headers when available.
- Scans JPEG, PNG, and WebP containers for selected EXIF, XMP, IPTC, and text markers.
- Does not decode image pixels, parse EXIF values such as camera model or GPS coordinates, or modify image files.
- Metadata status is reported as unknown when the format is unsupported or a header scan is incomplete. “No scanned markers found” is limited to the inspected marker types.
- Files are read locally in the browser; their contents are not uploaded to an application server.

## Project Structure

```text
opensource-image-tools/
├── index.html
├── package.json
└── src/
    ├── main.js
    └── style.css
```

The project is a standalone companion to [ImagePixelConverter](https://imagepixelconverter.com/).
