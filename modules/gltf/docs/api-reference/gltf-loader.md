# GLTFLoader

Parses a glTF file. Can load both the `.glb` (binary) and `.gltf` (text/json) file format variants.

A glTF file contains a hierarchical scenegraph description that can be used to instantiate corresponding hierarcy of actual `Scenegraph` related classes in most WebGL libraries.

| Loader          | Characteristic                                                             |
| --------------- | -------------------------------------------------------------------------- |
| File Extensions | `.glb`, `.gltf`                                                            |
| File Type       | Binary, JSON, Linked Assets                                                |
| File Format     | [glTF](https://github.com/KhronosGroup/glTF/tree/master/specification/2.0) |
| Data Format     | [Scenegraph](/docs/specifications/category-scenegraph)                     |
| Supported APIs  | `load`, `parse`, `parseSync`                                               |

## Usage

```
import {load} from '@loaders.gl/core';
import {GLTFLoader} from '@loaders.gl/gltf';
const gltf = await load(url, GLTFLoader);
```

To decompress Draco-compressed meshes:

```
import {load} from '@loaders.gl/core';
import {GLTFLoader} from '@loaders.gl/gltf';
import {DracoLoader} from '@loaders.gl/draco';
const gltf = load(url, GLTFLoader, {DracoLoader, decompress: true});
```

## Overview

The `GLTFLoader` aims to take care of as much processing as possible, while remaining framework-independent.

The GLTF Loader returns an object with a `json` field containing the glTF Scenegraph. In its basic mode, the `GLTFLoader` does not modify the loaded JSON in any way. Instead, the results of additional processing are placed in parallel top-level fields such as `buffers` and `images`. This ensures that applications that want to work with the standard glTF data structure can do so.

Optionally, the loaded gltf can be "post processed", which lightly annotates and transforms the loaded JSON structure to make it easier to use. Refer to [postProcessGLTF](docs/api-reference/gltf-loaders/gltf-extensions.md) for details.

In addition, certain glTF extensions, in particular Draco mesh encoding, can be fully or partially processed during loading. When possible (and extension processing is enabled), such extensions will be resolved/decompressed and replaced with standards conformant representations. See [glTF Extensions](docs/api-reference/gltf-loaders/gltf-extensions.md) for more information.

Note: while supported, synchronous parsing of glTF (e.g. using `parseSync()`) has significant limitations. When parsed asynchronously (using `await parse()` or `await load()`), the following additional capabilities are enabled:

- linked binary resource URI:s will be loaded and resolved (assuming a valid base url is available).
- base64 encoded binary URI:s inside the JSON payload will be decoded.
- linked image URI:s can be loaded and decoded.
- Draco meshes can be decoded asynchronously on worker threads (in parallel!).

## Options

| Option             | Type    | Default |                                                                                | Description |
| ------------------ | ------- | ------- | ------------------------------------------------------------------------------ | ----------- |
| `gltf.fetchImages` | Boolean | `false` | Fetch any referenced image files (and decode base64 encoded URIS). Async only. |
| `gltf.parseImages` | Boolean | `false` |
| `gltf.decompress`  | Boolean | `true`  | Decompress Draco compressed meshes (if DracoLoader available).                 |
| `gltf.postProcess` | Boolean | `true`  | Perform additional post processing before returning data.                      |

Remarks:

- `postProcess`: Performs additional [post processing](docs/api-reference/post-process-gltf) to simplify use in WebGL libraries. Changes the return value of the call.

## Data Format

### With Post Processing

The format of data returned by the `GLTFLoader` depends on whether the `gltf.postProcess` option is `true`. When true, the parsed JSON structure will be returned, and [post processing](docs/api-reference/post-process-gltf) will have been performed, which will link data from binary buffers into the parsed JSON structure using non-standard fields, and also modify the data in other ways to make it easier to use.

At the top level, this will look like a standard json structure:

```json
{
  scenes: [...],
  scene: ...,
  nodes: [...],
  ...
}
```

For details on the extra fields added to the returned data structure, see [post processing](docs/api-reference/post-process-gltf).

### With Post Processing

By setting `gltf.postProcess` to `false`, a "pure" gltf data structure will be returned, with binary buffers provided as an `ArrayBuffer` array.

```json
{
  // The base URI used to load this glTF, if any. For resolving relative uris to linked resources.
  baseUri: String,

  // JSON Chunk
  json: Object, // This will be the standard glTF json structuure shown above

  // Length and indices of this array will match `json.buffers`
  // The GLB bin chunk, if present, will be found in buffer 0.
  // Additional buffers are fetched or base64 decoded from the JSON uri:s.
  buffers: [{
    arrayBuffer: ArrayBuffer,
    byteOffset: Number,
    byteLength: Number
  }],

  // Images can optionally be loaded and decoded, they will be stored here
  // Length and indices of this array will match `json.buffers`
  images: Image[],

  // GLBLoader output, if this was a GLB encoded glTF
  _glb?: Object
}
```

| Field                     | Type          | Default                                                   | Description                                                      |
| ------------------------- | ------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `baseUri`                 | `String`      | `` | length of GLB (e.g. embedded in larger binary block) |
| `json`                    | `Object`      | `{}`                                                      | Parsed JSON from the JSON chunk                                  |
| `buffers`                 | `Object[]`    | `[]`                                                      | The version number                                               |
| `buffers[\*].arrayBuffer` | `ArrayBuffer` | `null`                                                    | The binary chunk                                                 |
| `buffers[\*].byteOffset`  | `Number`      | `null`                                                    | offset of buffer (embedded in larger binary block)               |
| `buffers[\*].byteLength`  | `ArrayBuffer` | `null`                                                    | length of buffer (embedded in larger binary block)               |
| `_glb`?                   | `Object`      | N/A                                                       | The output of the GLBLoader if the parsed file was GLB formatted |
