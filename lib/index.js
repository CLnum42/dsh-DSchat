var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/cosmokit/lib/index.cjs
var require_lib = __commonJS({
  "node_modules/cosmokit/lib/index.cjs"(exports, module) {
    "use strict";
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __hasOwnProp2 = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name2 in all)
        __defProp2(target, name2, { get: all[name2], enumerable: true });
    };
    var __copyProps2 = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp2.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps2(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export(index_exports, {
      Binary: () => Binary,
      Time: () => Time,
      arrayBufferToBase64: () => arrayBufferToBase64,
      arrayBufferToHex: () => arrayBufferToHex,
      base64ToArrayBuffer: () => base64ToArrayBuffer,
      camelCase: () => camelCase,
      camelize: () => camelize,
      capitalize: () => capitalize,
      clone: () => clone,
      contain: () => contain,
      deduplicate: () => deduplicate,
      deepEqual: () => deepEqual,
      defineProperty: () => defineProperty,
      difference: () => difference,
      filterKeys: () => filterKeys,
      formatProperty: () => formatProperty,
      hexToArrayBuffer: () => hexToArrayBuffer,
      hyphenate: () => hyphenate,
      intersection: () => intersection,
      is: () => is,
      isNonNullable: () => isNonNullable,
      isNullable: () => isNullable,
      isPlainObject: () => isPlainObject,
      makeArray: () => makeArray,
      mapValues: () => mapValues,
      noop: () => noop,
      omit: () => omit,
      paramCase: () => paramCase,
      pick: () => pick,
      remove: () => remove,
      sanitize: () => sanitize,
      snakeCase: () => snakeCase,
      trimSlash: () => trimSlash,
      uncapitalize: () => uncapitalize,
      union: () => union,
      valueMap: () => mapValues
    });
    module.exports = __toCommonJS(index_exports);
    function noop() {
    }
    function isNullable(value) {
      return value === null || value === void 0;
    }
    function isNonNullable(value) {
      return !isNullable(value);
    }
    function isPlainObject(data) {
      return data && typeof data === "object" && !Array.isArray(data);
    }
    function filterKeys(object, filter) {
      return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
    }
    function mapValues(object, transform) {
      return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
    }
    function pick(source, keys, forced) {
      if (!keys) return { ...source };
      const result = {};
      for (const key of keys) {
        if (forced || source[key] !== void 0) result[key] = source[key];
      }
      return result;
    }
    function omit(source, keys) {
      if (!keys) return { ...source };
      const result = { ...source };
      for (const key of keys) {
        Reflect.deleteProperty(result, key);
      }
      return result;
    }
    function defineProperty(object, key, value) {
      return Object.defineProperty(object, key, { writable: true, value, enumerable: false });
    }
    function contain(array1, array2) {
      return array2.every((item) => array1.includes(item));
    }
    function intersection(array1, array2) {
      return array1.filter((item) => array2.includes(item));
    }
    function difference(array1, array2) {
      return array1.filter((item) => !array2.includes(item));
    }
    function union(array1, array2) {
      return Array.from(/* @__PURE__ */ new Set([...array1, ...array2]));
    }
    function deduplicate(array) {
      return [...new Set(array)];
    }
    function remove(list, item) {
      const index = list?.indexOf(item);
      if (index >= 0) {
        list.splice(index, 1);
        return true;
      } else {
        return false;
      }
    }
    function makeArray(source) {
      return Array.isArray(source) ? source : isNullable(source) ? [] : [source];
    }
    function is(type, value) {
      if (arguments.length === 1) return (value2) => is(type, value2);
      return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
    }
    function isArrayBufferLike(value) {
      return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
    }
    function isArrayBufferSource(value) {
      return isArrayBufferLike(value) || ArrayBuffer.isView(value);
    }
    var Binary;
    ((Binary2) => {
      Binary2.is = isArrayBufferLike;
      Binary2.isSource = isArrayBufferSource;
      function fromSource(source) {
        if (ArrayBuffer.isView(source)) {
          return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        } else {
          return source;
        }
      }
      Binary2.fromSource = fromSource;
      function toBase64(source) {
        source = fromSource(source);
        if (typeof Buffer !== "undefined") {
          return Buffer.from(source).toString("base64");
        }
        let binary = "";
        const bytes = new Uint8Array(source);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      }
      Binary2.toBase64 = toBase64;
      function fromBase64(source) {
        if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
        return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
      }
      Binary2.fromBase64 = fromBase64;
      function toHex(source) {
        source = fromSource(source);
        if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
        return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      Binary2.toHex = toHex;
      function fromHex(source) {
        if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
        const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
        const buffer = [];
        for (let i = 0; i < hex.length; i += 2) {
          buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
        }
        return Uint8Array.from(buffer).buffer;
      }
      Binary2.fromHex = fromHex;
    })(Binary || (Binary = {}));
    var base64ToArrayBuffer = Binary.fromBase64;
    var arrayBufferToBase64 = Binary.toBase64;
    var hexToArrayBuffer = Binary.fromHex;
    var arrayBufferToHex = Binary.toHex;
    function clone(source, refs = /* @__PURE__ */ new Map()) {
      if (!source || typeof source !== "object") return source;
      if (is("Date", source)) return new Date(source.valueOf());
      if (is("RegExp", source)) return new RegExp(source.source, source.flags);
      if (isArrayBufferLike(source)) return source.slice(0);
      if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      const cached = refs.get(source);
      if (cached) return cached;
      if (Array.isArray(source)) {
        const result2 = [];
        refs.set(source, result2);
        source.forEach((value, index) => {
          result2[index] = Reflect.apply(clone, null, [value, refs]);
        });
        return result2;
      }
      const result = Object.create(Object.getPrototypeOf(source));
      refs.set(source, result);
      for (const key of Reflect.ownKeys(source)) {
        const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
        if ("value" in descriptor) {
          descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
        }
        Reflect.defineProperty(result, key, descriptor);
      }
      return result;
    }
    function deepEqual(a, b, strict) {
      if (a === b) return true;
      if (!strict && isNullable(a) && isNullable(b)) return true;
      if (typeof a !== typeof b) return false;
      if (typeof a !== "object") return false;
      if (!a || !b) return false;
      function check(test, then) {
        return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
      }
      return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
        if (a2.byteLength !== b2.byteLength) return false;
        const viewA = new Uint8Array(a2);
        const viewB = new Uint8Array(b2);
        for (let i = 0; i < viewA.length; i++) {
          if (viewA[i] !== viewB[i]) return false;
        }
        return true;
      }) ?? Object.keys({ ...a, ...b }).every((key) => deepEqual(a[key], b[key], strict));
    }
    function capitalize(source) {
      return source.charAt(0).toUpperCase() + source.slice(1);
    }
    function uncapitalize(source) {
      return source.charAt(0).toLowerCase() + source.slice(1);
    }
    function camelCase(source) {
      return source.replace(/[_-][a-z]/g, (str) => str.slice(1).toUpperCase());
    }
    function tokenize(source, delimiters, delimiter) {
      const output = [];
      let state = 0;
      for (let i = 0; i < source.length; i++) {
        const code = source.charCodeAt(i);
        if (code >= 65 && code <= 90) {
          if (state === 1) {
            const next = source.charCodeAt(i + 1);
            if (next >= 97 && next <= 122) {
              output.push(delimiter);
            }
            output.push(code + 32);
          } else {
            if (state !== 0) {
              output.push(delimiter);
            }
            output.push(code + 32);
          }
          state = 1;
        } else if (code >= 97 && code <= 122) {
          output.push(code);
          state = 2;
        } else if (delimiters.includes(code)) {
          if (state !== 0) {
            output.push(delimiter);
          }
          state = 0;
        } else {
          output.push(code);
        }
      }
      return String.fromCharCode(...output);
    }
    function paramCase(source) {
      return tokenize(source, [45, 95], 45);
    }
    function snakeCase(source) {
      return tokenize(source, [45, 95], 95);
    }
    var camelize = camelCase;
    var hyphenate = paramCase;
    function formatProperty(key) {
      if (typeof key !== "string") return `[${key.toString()}]`;
      return /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
    }
    function trimSlash(source) {
      return source.replace(/\/$/, "");
    }
    function sanitize(source) {
      if (!source.startsWith("/")) source = "/" + source;
      return trimSlash(source);
    }
    var Time;
    ((Time2) => {
      Time2.millisecond = 1;
      Time2.second = 1e3;
      Time2.minute = Time2.second * 60;
      Time2.hour = Time2.minute * 60;
      Time2.day = Time2.hour * 24;
      Time2.week = Time2.day * 7;
      let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
      function setTimezoneOffset(offset) {
        timezoneOffset = offset;
      }
      Time2.setTimezoneOffset = setTimezoneOffset;
      function getTimezoneOffset() {
        return timezoneOffset;
      }
      Time2.getTimezoneOffset = getTimezoneOffset;
      function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
        if (typeof date === "number") date = new Date(date);
        if (offset === void 0) offset = timezoneOffset;
        return Math.floor((date.valueOf() / Time2.minute - offset) / 1440);
      }
      Time2.getDateNumber = getDateNumber;
      function fromDateNumber(value, offset) {
        const date = new Date(value * Time2.day);
        if (offset === void 0) offset = timezoneOffset;
        return new Date(+date + offset * Time2.minute);
      }
      Time2.fromDateNumber = fromDateNumber;
      const numeric = /\d+(?:\.\d+)?/.source;
      const timeRegExp = new RegExp(`^${[
        "w(?:eek(?:s)?)?",
        "d(?:ay(?:s)?)?",
        "h(?:our(?:s)?)?",
        "m(?:in(?:ute)?(?:s)?)?",
        "s(?:ec(?:ond)?(?:s)?)?"
      ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
      function parseTime(source) {
        const capture = timeRegExp.exec(source);
        if (!capture) return 0;
        return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
      }
      Time2.parseTime = parseTime;
      function parseDate(date) {
        const parsed = parseTime(date);
        if (parsed) {
          date = Date.now() + parsed;
        } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
          date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
        } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
          date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
        }
        return date ? new Date(date) : /* @__PURE__ */ new Date();
      }
      Time2.parseDate = parseDate;
      function format(ms) {
        const abs = Math.abs(ms);
        if (abs >= Time2.day - Time2.hour / 2) {
          return Math.round(ms / Time2.day) + "d";
        } else if (abs >= Time2.hour - Time2.minute / 2) {
          return Math.round(ms / Time2.hour) + "h";
        } else if (abs >= Time2.minute - Time2.second / 2) {
          return Math.round(ms / Time2.minute) + "m";
        } else if (abs >= Time2.second) {
          return Math.round(ms / Time2.second) + "s";
        }
        return ms + "ms";
      }
      Time2.format = format;
      function toDigits(source, length = 2) {
        return source.toString().padStart(length, "0");
      }
      Time2.toDigits = toDigits;
      function template(template2, time = /* @__PURE__ */ new Date()) {
        return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
      }
      Time2.template = template;
    })(Time || (Time = {}));
  }
});

// node_modules/schemastery/lib/index.cjs
var require_lib2 = __commonJS({
  "node_modules/schemastery/lib/index.cjs"(exports, module) {
    "use strict";
    var __defProp2 = Object.defineProperty;
    var __name = (target, value) => __defProp2(target, "name", { value, configurable: true });
    var import_cosmokit = require_lib();
    var kSchema = Symbol.for("schemastery");
    var kValidationError = Symbol.for("ValidationError");
    globalThis.__schemastery_index__ ??= 0;
    globalThis.__schemastery_refs__ = void 0;
    var ValidationError = class extends TypeError {
      constructor(message, options) {
        let prefix = "$";
        for (const segment of options.path || []) {
          if (typeof segment === "string") {
            prefix += "." + segment;
          } else if (typeof segment === "number") {
            prefix += "[" + segment + "]";
          } else if (typeof segment === "symbol") {
            prefix += `[Symbol(${segment.toString()})]`;
          }
        }
        if (prefix.startsWith(".")) prefix = prefix.slice(1);
        super((prefix === "$" ? "" : `${prefix} `) + message);
        this.options = options;
      }
      static {
        __name(this, "ValidationError");
      }
      name = "ValidationError";
      static is(error) {
        return !!error?.[kValidationError];
      }
    };
    Object.defineProperty(ValidationError.prototype, kValidationError, {
      value: true
    });
    var Schema = /* @__PURE__ */ __name(function(options) {
      const schema = /* @__PURE__ */ __name(function(data, options2 = {}) {
        return Schema.resolve(data, schema, options2)[0];
      }, "schema");
      if (options.refs) {
        const refs = (0, import_cosmokit.valueMap)(options.refs, (options2) => new Schema(options2));
        const getRef = /* @__PURE__ */ __name((uid) => refs[uid], "getRef");
        for (const key in refs) {
          const options2 = refs[key];
          options2.sKey = getRef(options2.sKey);
          options2.inner = getRef(options2.inner);
          options2.list = options2.list && options2.list.map(getRef);
          options2.dict = options2.dict && (0, import_cosmokit.valueMap)(options2.dict, getRef);
        }
        return refs[options.uid];
      }
      Object.assign(schema, options);
      if (typeof schema.callback === "string") {
        try {
          schema.callback = new Function("return " + schema.callback)();
        } catch {
        }
      }
      Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
      Object.setPrototypeOf(schema, Schema.prototype);
      schema.meta ||= {};
      schema.toString = schema.toString.bind(schema);
      return schema;
    }, "Schema");
    Schema.prototype = Object.create(Function.prototype);
    Schema.prototype[kSchema] = true;
    Object.defineProperty(Schema.prototype, "~standard", {
      get() {
        return {
          version: 1,
          vendor: "schemastery",
          validate: /* @__PURE__ */ __name((value) => {
            try {
              return { value: Schema.resolve(value, this, {})[0] };
            } catch (error) {
              if (ValidationError.is(error)) {
                return { issues: [{ message: error.message, path: error.options.path }] };
              }
              throw error;
            }
          }, "validate")
        };
      }
    });
    Schema.ValidationError = ValidationError;
    Schema.prototype.toJSON = /* @__PURE__ */ __name(function toJSON() {
      if (globalThis.__schemastery_refs__) {
        globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
        return this.uid;
      }
      globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
      globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
      const result = { uid: this.uid, refs: globalThis.__schemastery_refs__ };
      globalThis.__schemastery_refs__ = void 0;
      return result;
    }, "toJSON");
    Schema.prototype.set = /* @__PURE__ */ __name(function set(key, value) {
      this.dict[key] = value;
      return this;
    }, "set");
    Schema.prototype.push = /* @__PURE__ */ __name(function push(value) {
      this.list.push(value);
      return this;
    }, "push");
    function mergeDesc(original, messages) {
      const result = typeof original === "string" ? { "": original } : { ...original };
      for (const locale in messages) {
        const value = messages[locale];
        if (value?.$description || value?.$desc) {
          result[locale] = value.$description || value.$desc;
        } else if (typeof value === "string") {
          result[locale] = value;
        }
      }
      return result;
    }
    __name(mergeDesc, "mergeDesc");
    function getInner(value) {
      return value?.$value ?? value?.$inner;
    }
    __name(getInner, "getInner");
    function extractKeys(data) {
      return (0, import_cosmokit.filterKeys)(data ?? {}, (key) => !key.startsWith("$"));
    }
    __name(extractKeys, "extractKeys");
    Schema.prototype.i18n = /* @__PURE__ */ __name(function i18n(messages) {
      const schema = Schema(this);
      const desc = mergeDesc(schema.meta.description, messages);
      if (Object.keys(desc).length) schema.meta.description = desc;
      if (schema.dict) {
        schema.dict = (0, import_cosmokit.valueMap)(schema.dict, (inner, key) => {
          return inner.i18n((0, import_cosmokit.valueMap)(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
        });
      }
      if (schema.list) {
        schema.list = schema.list.map((inner, index) => {
          return inner.i18n((0, import_cosmokit.valueMap)(messages, (data = {}) => {
            if (Array.isArray(getInner(data))) return getInner(data)[index];
            if (Array.isArray(data)) return data[index];
            return extractKeys(data);
          }));
        });
      }
      if (schema.inner) {
        schema.inner = schema.inner.i18n((0, import_cosmokit.valueMap)(messages, (data) => {
          if (getInner(data)) return getInner(data);
          return extractKeys(data);
        }));
      }
      if (schema.sKey) {
        schema.sKey = schema.sKey.i18n((0, import_cosmokit.valueMap)(messages, (data) => data?.$key));
      }
      return schema;
    }, "i18n");
    Schema.prototype.extra = /* @__PURE__ */ __name(function extra(key, value) {
      const schema = Schema(this);
      schema.meta = { ...schema.meta, [key]: value };
      return schema;
    }, "extra");
    for (const key of ["required", "disabled", "collapse", "hidden", "loose"]) {
      Object.assign(Schema.prototype, {
        [key](value = true) {
          const schema = Schema(this);
          schema.meta = { ...schema.meta, [key]: value };
          return schema;
        }
      });
    }
    Schema.prototype.deprecated = /* @__PURE__ */ __name(function deprecated() {
      const schema = Schema(this);
      schema.meta.badges ||= [];
      schema.meta.badges.push({ text: "deprecated", type: "danger" });
      return schema;
    }, "deprecated");
    Schema.prototype.experimental = /* @__PURE__ */ __name(function experimental() {
      const schema = Schema(this);
      schema.meta.badges ||= [];
      schema.meta.badges.push({ text: "experimental", type: "warning" });
      return schema;
    }, "experimental");
    Schema.prototype.pattern = /* @__PURE__ */ __name(function pattern(regexp) {
      const schema = Schema(this);
      const pattern2 = (0, import_cosmokit.pick)(regexp, ["source", "flags"]);
      schema.meta = { ...schema.meta, pattern: pattern2 };
      return schema;
    }, "pattern");
    Schema.prototype.simplify = /* @__PURE__ */ __name(function simplify(value) {
      if ((0, import_cosmokit.deepEqual)(value, this.meta.default, this.type === "dict")) return null;
      if ((0, import_cosmokit.isNullable)(value)) return value;
      if (this.type === "object" || this.type === "dict") {
        const result = {};
        for (const key in value) {
          const schema = this.type === "object" ? this.dict[key] : this.inner;
          const item = schema?.simplify(value[key]);
          if (this.type === "dict" || !(0, import_cosmokit.isNullable)(item)) result[key] = item;
        }
        if ((0, import_cosmokit.deepEqual)(result, this.meta.default, this.type === "dict")) return null;
        return result;
      } else if (this.type === "array" || this.type === "tuple") {
        const result = [];
        value.forEach((value2, index) => {
          const schema = this.type === "array" ? this.inner : this.list[index];
          const item = schema ? schema.simplify(value2) : value2;
          result.push(item);
        });
        return result;
      } else if (this.type === "intersect") {
        const result = {};
        for (const item of this.list) {
          Object.assign(result, item.simplify(value));
        }
        return result;
      } else if (this.type === "union") {
        for (const schema of this.list) {
          try {
            Schema.resolve(value, schema, {});
            return schema.simplify(value);
          } catch {
          }
        }
      }
      return value;
    }, "simplify");
    Schema.prototype.toString = /* @__PURE__ */ __name(function toString(inline) {
      return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
    }, "toString");
    Schema.prototype.role = /* @__PURE__ */ __name(function role(role, extra2) {
      const schema = Schema(this);
      schema.meta = { ...schema.meta, role, extra: extra2 };
      return schema;
    }, "role");
    for (const key of ["default", "link", "comment", "description", "max", "min", "step"]) {
      Object.assign(Schema.prototype, {
        [key](value) {
          const schema = Schema(this);
          schema.meta = { ...schema.meta, [key]: value };
          return schema;
        }
      });
    }
    var resolvers = {};
    Schema.extend = /* @__PURE__ */ __name(function extend(type, resolve2) {
      resolvers[type] = resolve2;
    }, "extend");
    Schema.resolve = /* @__PURE__ */ __name(function resolve2(data, schema, options = {}, strict = false) {
      if (!schema) return [data];
      if (options.ignore?.(data, schema)) return [data];
      if ((0, import_cosmokit.isNullable)(data) && schema.type !== "lazy") {
        if (schema.meta.required) throw new ValidationError(`missing required value`, options);
        let current = schema;
        let fallback = schema.meta.default;
        while (current?.type === "intersect" && (0, import_cosmokit.isNullable)(fallback)) {
          current = current.list[0];
          fallback = current?.meta.default;
        }
        if ((0, import_cosmokit.isNullable)(fallback)) return [data];
        data = (0, import_cosmokit.clone)(fallback);
      }
      const callback = resolvers[schema.type];
      if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
      try {
        return callback(data, schema, options, strict);
      } catch (error) {
        if (!schema.meta.loose) throw error;
        return [schema.meta.default];
      }
    }, "resolve");
    Schema.from = /* @__PURE__ */ __name(function from(source) {
      if ((0, import_cosmokit.isNullable)(source)) {
        return Schema.any();
      } else if (["string", "number", "boolean"].includes(typeof source)) {
        return Schema.const(source).required();
      } else if (source[kSchema]) {
        return source;
      } else if (typeof source === "function") {
        switch (source) {
          case String:
            return Schema.string().required();
          case Number:
            return Schema.number().required();
          case Boolean:
            return Schema.boolean().required();
          case Function:
            return Schema.function().required();
          default:
            return Schema.is(source).required();
        }
      } else {
        throw new TypeError(`cannot infer schema from ${source}`);
      }
    }, "from");
    Schema.lazy = /* @__PURE__ */ __name(function lazy(builder) {
      const toJSON2 = /* @__PURE__ */ __name(() => {
        if (!schema.inner[kSchema]) {
          schema.inner = schema.builder();
          schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
        }
        return schema.inner.toJSON();
      }, "toJSON");
      const schema = new Schema({ type: "lazy", builder, inner: { toJSON: toJSON2 } });
      return schema;
    }, "lazy");
    Schema.natural = /* @__PURE__ */ __name(function natural() {
      return Schema.number().step(1).min(0);
    }, "natural");
    Schema.percent = /* @__PURE__ */ __name(function percent() {
      return Schema.number().step(0.01).min(0).max(1).role("slider");
    }, "percent");
    Schema.date = /* @__PURE__ */ __name(function date() {
      return Schema.union([
        Schema.is(Date),
        Schema.transform(Schema.string().role("datetime"), (value, options) => {
          const date2 = new Date(value);
          if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
          return date2;
        }, true)
      ]);
    }, "date");
    Schema.regExp = /* @__PURE__ */ __name(function regExp(flag = "") {
      return Schema.union([
        Schema.is(RegExp),
        Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
          try {
            return new RegExp(value, flag);
          } catch (e) {
            throw new ValidationError(e.message, options);
          }
        }, true)
      ]);
    }, "regExp");
    Schema.arrayBuffer = /* @__PURE__ */ __name(function arrayBuffer(encoding) {
      return Schema.union([
        Schema.is(ArrayBuffer),
        Schema.is(SharedArrayBuffer),
        Schema.transform(Schema.any(), (value, options) => {
          if (import_cosmokit.Binary.isSource(value)) return import_cosmokit.Binary.fromSource(value);
          throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
        }, true),
        ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
          try {
            return encoding === "base64" ? import_cosmokit.Binary.fromBase64(value) : import_cosmokit.Binary.fromHex(value);
          } catch (e) {
            throw new ValidationError(e.message, options);
          }
        }, true)] : []
      ]);
    }, "arrayBuffer");
    Schema.extend("lazy", (data, schema, options, strict) => {
      if (!schema.inner[kSchema]) {
        schema.inner = schema.builder();
        schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
      }
      return Schema.resolve(data, schema.inner, options, strict);
    });
    Schema.extend("any", (data) => {
      return [data];
    });
    Schema.extend("never", (data, _, options) => {
      throw new ValidationError(`expected nullable but got ${data}`, options);
    });
    Schema.extend("const", (data, { value }, options) => {
      if ((0, import_cosmokit.deepEqual)(data, value)) return [value];
      throw new ValidationError(`expected ${value} but got ${data}`, options);
    });
    function checkWithinRange(data, meta, description, options, skipMin = false) {
      const { max = Infinity, min = -Infinity } = meta;
      if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
      if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
    }
    __name(checkWithinRange, "checkWithinRange");
    Schema.extend("string", (data, { meta }, options) => {
      if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
      if (meta.pattern) {
        const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
        if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
      }
      checkWithinRange(data.length, meta, "string length", options);
      return [data];
    });
    function decimalShift(data, digits) {
      const str = data.toString();
      if (str.includes("e")) return data * Math.pow(10, digits);
      const index = str.indexOf(".");
      if (index === -1) return data * Math.pow(10, digits);
      const frac = str.slice(index + 1);
      const integer = str.slice(0, index);
      if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
      return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
    }
    __name(decimalShift, "decimalShift");
    function isMultipleOf(data, min, step) {
      step = Math.abs(step);
      if (!/^\d+\.\d+$/.test(step.toString())) {
        return (data - min) % step === 0;
      }
      const index = step.toString().indexOf(".");
      const digits = step.toString().slice(index + 1).length;
      return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
    }
    __name(isMultipleOf, "isMultipleOf");
    Schema.extend("number", (data, { meta }, options) => {
      if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
      checkWithinRange(data, meta, "number", options);
      const { step } = meta;
      if (step && !isMultipleOf(data, meta.min ?? 0, step)) {
        throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
      }
      return [data];
    });
    Schema.extend("boolean", (data, _, options) => {
      if (typeof data === "boolean") return [data];
      throw new ValidationError(`expected boolean but got ${data}`, options);
    });
    Schema.extend("bitset", (data, { bits, meta }, options) => {
      let value = 0, keys = [];
      if (typeof data === "number") {
        value = data;
        for (const key in bits) {
          if (data & bits[key]) {
            keys.push(key);
          }
        }
      } else if (Array.isArray(data)) {
        keys = data;
        for (const key of keys) {
          if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
          if (key in bits) value |= bits[key];
        }
      } else {
        throw new ValidationError(`expected number or array but got ${data}`, options);
      }
      if (value === meta.default) return [value];
      return [value, keys];
    });
    Schema.extend("function", (data, _, options) => {
      if (typeof data === "function") return [data];
      throw new ValidationError(`expected function but got ${data}`, options);
    });
    Schema.extend("is", (data, { constructor }, options) => {
      if (typeof constructor === "function") {
        if (data instanceof constructor) return [data];
        throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
      } else {
        if ((0, import_cosmokit.isNullable)(data)) {
          throw new ValidationError(`expected ${constructor} but got ${data}`, options);
        }
        let prototype = Object.getPrototypeOf(data);
        while (prototype) {
          if (prototype.constructor?.name === constructor) return [data];
          prototype = Object.getPrototypeOf(prototype);
        }
        throw new ValidationError(`expected ${constructor} but got ${data}`, options);
      }
    });
    function property(data, key, schema, options) {
      try {
        const [value, adapted] = Schema.resolve(data[key], schema, {
          ...options,
          path: [...options.path || [], key]
        });
        if (adapted !== void 0) data[key] = adapted;
        return value;
      } catch (e) {
        if (!options?.autofix) throw e;
        delete data[key];
        return schema.meta.default;
      }
    }
    __name(property, "property");
    Schema.extend("array", (data, { inner, meta }, options) => {
      if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
      checkWithinRange(data.length, meta, "array length", options, !(0, import_cosmokit.isNullable)(inner.meta.default));
      return [data.map((_, index) => property(data, index, inner, options))];
    });
    Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
      if (!(0, import_cosmokit.isPlainObject)(data)) throw new ValidationError(`expected object but got ${data}`, options);
      const result = {};
      for (const key in data) {
        let rKey;
        try {
          rKey = Schema.resolve(key, sKey, options)[0];
        } catch (error) {
          if (strict) continue;
          throw error;
        }
        result[rKey] = property(data, key, inner, options);
        data[rKey] = data[key];
        if (key !== rKey) delete data[key];
      }
      return [result];
    });
    Schema.extend("tuple", (data, { list }, options, strict) => {
      if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
      const result = list.map((inner, index) => property(data, index, inner, options));
      if (strict) return [result];
      result.push(...data.slice(list.length));
      return [result];
    });
    function merge(result, data) {
      for (const key in data) {
        if (key in result) continue;
        result[key] = data[key];
      }
    }
    __name(merge, "merge");
    Schema.extend("object", (data, { dict }, options, strict) => {
      if (!(0, import_cosmokit.isPlainObject)(data)) throw new ValidationError(`expected object but got ${data}`, options);
      const result = {};
      for (const key in dict) {
        const value = property(data, key, dict[key], options);
        if (!(0, import_cosmokit.isNullable)(value) || key in data) {
          result[key] = value;
        }
      }
      if (!strict) merge(result, data);
      return [result];
    });
    Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
      const messages = [];
      for (const inner of list) {
        try {
          return Schema.resolve(data, inner, options, strict);
        } catch (error) {
          messages.push(error);
        }
      }
      throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    });
    Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
      if (!list.length) return [data];
      let result;
      for (const inner of list) {
        const value = Schema.resolve(data, inner, options, true)[0];
        if ((0, import_cosmokit.isNullable)(value)) continue;
        if ((0, import_cosmokit.isNullable)(result)) {
          result = value;
        } else if (typeof result !== typeof value) {
          throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
        } else if (typeof value === "object") {
          merge(result ??= {}, value);
        } else if (result !== value) {
          throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
        }
      }
      if (!strict && (0, import_cosmokit.isPlainObject)(data)) merge(result, data);
      return [result];
    });
    Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
      const [result, adapted = data] = Schema.resolve(data, inner, options, true);
      if (preserve) {
        return [callback(result)];
      } else {
        return [callback(result), callback(adapted)];
      }
    });
    var formatters = {};
    function defineMethod(name2, keys, format) {
      formatters[name2] = format;
      Object.assign(Schema, {
        [name2](...args) {
          const schema = new Schema({ type: name2 });
          keys.forEach((key, index) => {
            switch (key) {
              case "sKey":
                schema.sKey = args[index] ?? Schema.string();
                break;
              case "inner":
                schema.inner = Schema.from(args[index]);
                break;
              case "list":
                schema.list = args[index].map(Schema.from);
                break;
              case "dict":
                schema.dict = (0, import_cosmokit.valueMap)(args[index], Schema.from);
                break;
              case "bits": {
                schema.bits = {};
                for (const key2 in args[index]) {
                  if (typeof args[index][key2] !== "number") continue;
                  schema.bits[key2] = args[index][key2];
                }
                break;
              }
              case "callback": {
                const callback = schema.callback = args[index];
                callback["toJSON"] ||= () => callback.toString();
                break;
              }
              case "constructor": {
                const constructor = schema.constructor = args[index];
                if (typeof constructor === "function") {
                  ;
                  constructor["toJSON"] ||= () => constructor["name"];
                }
                break;
              }
              default:
                schema[key] = args[index];
            }
          });
          if (name2 === "object" || name2 === "dict") {
            schema.meta.default = {};
          } else if (name2 === "array" || name2 === "tuple") {
            schema.meta.default = [];
          } else if (name2 === "bitset") {
            schema.meta.default = 0;
          }
          return schema;
        }
      });
    }
    __name(defineMethod, "defineMethod");
    defineMethod("is", ["constructor"], ({ constructor }) => {
      if (typeof constructor === "function") {
        return constructor.name;
      } else {
        return constructor;
      }
    });
    defineMethod("any", [], () => "any");
    defineMethod("never", [], () => "never");
    defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
    defineMethod("string", [], () => "string");
    defineMethod("number", [], () => "number");
    defineMethod("boolean", [], () => "boolean");
    defineMethod("bitset", ["bits"], () => "bitset");
    defineMethod("function", [], () => "function");
    defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
    defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
    defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
    defineMethod("object", ["dict"], ({ dict }) => {
      if (Object.keys(dict).length === 0) return "{}";
      return `{ ${Object.entries(dict).map(([key, inner]) => {
        return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
      }).join(", ")} }`;
    });
    defineMethod("union", ["list"], ({ list }, inline) => {
      const result = list.map(({ toString: format }) => format()).join(" | ");
      return inline ? `(${result})` : result;
    });
    defineMethod("intersect", ["list"], ({ list }) => {
      return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
    });
    defineMethod("transform", ["inner", "callback", "preserve"], ({ inner }, isInner) => inner.toString(isInner));
    module.exports = Schema;
  }
});

// src/index.ts
var import_schemastery = __toESM(require_lib2(), 1);
import { existsSync as existsSync2 } from "node:fs";

// src/engine/engine.ts
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

// src/protocol.ts
function hasAnswerBody(markdown) {
  const text2 = markdown.trimStart();
  if (!text2.startsWith("<details>")) return text2 !== "";
  const close = text2.indexOf("</details>");
  if (close < 0) return false;
  return text2.slice(close + "</details>".length).trim() !== "";
}
function sourcesOf(input) {
  if (input === void 0 || input.length === 0) return void 0;
  let end = input.length;
  while (end > 0 && (input[end - 1]?.url ?? "") === "") end--;
  if (end === 0) return void 0;
  return input.slice(0, end).map((source) => source?.title === void 0 ? { url: source?.url ?? "" } : { url: source.url, title: source.title });
}

// src/engine/html-md.ts
function escapeText(text2) {
  return text2.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/\n{3,}/g, "\n\n");
}
var TEXT_NODE = 3;
function htmlToMarkdown(root) {
  if (root === null || root === void 0) return "";
  if (root.nodeType === TEXT_NODE) return escapeText(root.textContent ?? "");
  const tag = (root.tagName ?? "").toLowerCase();
  const text2 = (children) => (children ?? []).map(htmlToMarkdown).join("");
  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n---\n";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      return `
${"#".repeat(level)} ${text2(root.children).trim()}
`;
    }
    case "p":
      return `
${text2(root.children).trim()}
`;
    case "strong":
    case "b":
      return `**${text2(root.children).trim()}**`;
    case "em":
    case "i":
      return `*${text2(root.children).trim()}*`;
    case "code": {
      const parentPre = root.parent?.tagName?.toLowerCase() === "pre";
      if (parentPre) return text2(root.children);
      return `\`${(root.textContent ?? "").replace(/`/g, "\\`")}\``;
    }
    case "pre": {
      const code = root.children?.find((child) => (child.tagName ?? "").toLowerCase() === "code") ?? root;
      const raw = code.textContent ?? "";
      const className = code.className ?? "";
      const language = /language-([a-zA-Z0-9_+-]+)/.exec(className)?.[1] ?? "";
      const fence = "```";
      return `
${fence}${language}
${raw.replace(/\n$/, "")}
${fence}
`;
    }
    case "a": {
      const href = root.attributes?.href;
      const label = text2(root.children).trim();
      if (href === void 0 || href === "" || href.startsWith("javascript:")) return label;
      return `[${label || href}](${href})`;
    }
    case "img": {
      const src = root.attributes?.src;
      const alt = root.attributes?.alt ?? "";
      return src === void 0 ? "" : `![${alt}](${src})`;
    }
    case "ul":
      return `
${(root.children ?? []).map((child) => {
        if ((child.tagName ?? "").toLowerCase() === "li") return `- ${text2(child.children).trim()}`;
        return htmlToMarkdown(child);
      }).join("\n")}
`;
    case "ol": {
      let index = 1;
      return `
${(root.children ?? []).map((child) => {
        if ((child.tagName ?? "").toLowerCase() === "li") return `${index++}. ${text2(child.children).trim()}`;
        return htmlToMarkdown(child);
      }).join("\n")}
`;
    }
    case "li":
      return text2(root.children).trim();
    case "blockquote":
      return `
> ${text2(root.children).trim().replace(/\n/g, "\n> ")}
`;
    case "table": {
      const rows = (root.children ?? []).filter((child) => (child.tagName ?? "").toLowerCase() === "tr");
      if (rows.length === 0) return text2(root.children).trim();
      const cellsOf = (row) => (row.children ?? []).filter((child) => ["th", "td"].includes((child.tagName ?? "").toLowerCase())).map((cell) => text2(cell.children).trim().replace(/\|/g, "\\|"));
      const header = cellsOf(rows[0]);
      const body = rows.slice(1).map(cellsOf);
      const width = Math.max(header.length, ...body.map((row) => row.length));
      const pad = (cells) => {
        const filled = [...cells];
        while (filled.length < width) filled.push("");
        return `| ${filled.join(" | ")} |`;
      };
      const lines = [pad(header), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body.map(pad)];
      return `
${lines.join("\n")}
`;
    }
    case "tr":
    case "td":
    case "th":
    case "thead":
    case "tbody":
    case "tfoot":
      return text2(root.children);
    case "details":
      return `
<details>
${text2(root.children)}
</details>
`;
    case "summary":
      return `**${text2(root.children).trim()}**`;
    case "input": {
      const checked = root.attributes?.checked !== void 0;
      return checked ? "[x] " : "[ ] ";
    }
    case "math":
      return `$${root.textContent ?? ""}$`;
    case "svg":
    case "button":
    case "script":
    case "style":
      return "";
    case "div":
    case "span":
    case "section":
    case "article":
    case "main":
      return text2(root.children);
    default: {
      const direct = text2(root.children);
      return direct;
    }
  }
}
function serializeToMarkdown(root) {
  return htmlToMarkdown(root).replace(/\n{3,}/g, "\n\n").trim();
}

// src/engine/engine.ts
function isShutdownError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    // "Target page, context or browser has been closed", "Target closed",
    // "Page closed", "Browser has been closed", "Context closed".
    /\btarget\b[^.]*\bclosed\b/i,
    /\b(page|context|browser)\b[^.]*\bhas been closed\b/i,
    /\b(connection|protocol)\b[^.]*\bclosed\b/i,
    /Execution context was destroyed/i,
    /Browser closed/i
  ].some((pattern) => pattern.test(message));
}
var DEFAULT_TIMEOUT_MS = 18e4;
var STREAM_TICK_MS = 80;
var DOM_STABLE_MS = 1e3;
var SUBMIT_VERIFY_MS = 4e3;
var SUBMIT_VERIFY_POLL_MS = 100;
var WEB_CHAT_LINK_SELECTOR = 'a[href*="/a/chat/s/"]';
var WEB_MESSAGE_ITEM_SELECTOR = "[data-virtual-list-item-key]";
var WEB_STOP_SELECTORS = [
  '[role="button"][aria-label*="\u505C\u6B62"]',
  '[aria-label*="\u505C\u6B62"]',
  '[role="button"][aria-label*="stop generating" i]',
  '[aria-label*="stop generating" i]',
  '[role="button"]:has-text("\u505C\u6B62\u751F\u6210")',
  'button:has-text("\u505C\u6B62\u751F\u6210")',
  '[role="button"]:has-text("Stop generating")',
  'button:has-text("Stop generating")'
];
var WEB_NEW_CHAT_SELECTORS = [
  '[role="button"]:has-text("\u65B0\u5BF9\u8BDD")',
  'button:has-text("\u65B0\u5BF9\u8BDD")',
  '[role="button"]:has-text("New chat")',
  'button:has-text("New chat")',
  '[class*="newChat"]'
];
var CAPTURE_GENERATION = 6;
function streamCaptureInit() {
  const w = window;
  if (w.__wcCaptureInstalled === true) return;
  w.__wcCaptureInstalled = true;
  w.__wcGenSupported = 6;
  w.__wcGen = 0;
  w.__wcStream = { text: "", done: false, started: false, status: 0, error: "" };
  const X = w.XMLHttpRequest;
  const origOpen = X.prototype.open;
  const origSend = X.prototype.send;
  const guarded = () => w.__wcGenSupported === 6;
  const current = (gen) => guarded() === false || gen === w.__wcGen;
  const takeOwnership = (req) => {
    w.__wcStream = { text: "", done: false, started: true, status: 0, error: "" };
    w.__wcActiveReq = req;
    w.__wcReqLen = 0;
  };
  const append = (req, text2, complete, status) => {
    if (w.__wcActiveReq !== req) takeOwnership(req);
    const stream = w.__wcStream;
    if (stream === void 0) return;
    const seen = w.__wcReqLen ?? 0;
    if (text2.length > seen) {
      stream.text += text2.slice(seen);
      w.__wcReqLen = text2.length;
    }
    stream.started = true;
    if (complete) {
      stream.done = true;
      stream.status = status ?? stream.status;
      if (stream.status >= 400) stream.error = `HTTP ${stream.status}`;
    }
  };
  X.prototype.open = function(method, url, ...rest) {
    this.__wcIsChat = typeof url === "string" && url.includes("/chat/completion");
    return origOpen.call(this, method, url, ...rest);
  };
  X.prototype.send = function(...args) {
    if (this.__wcIsChat === true) {
      this.__wcGen = w.__wcGen ?? 0;
      this.__wcReq = w.__wcReqSeq = (w.__wcReqSeq ?? 0) + 1;
      let lastLen = 0;
      const xhr = this;
      xhr.addEventListener("progress", () => {
        const text2 = xhr.responseText ?? "";
        if (current(xhr.__wcGen) === false) return;
        if (text2.length > lastLen) {
          lastLen = text2.length;
          append(xhr.__wcReq, text2, false);
        }
      });
      xhr.addEventListener("loadend", () => {
        if (current(xhr.__wcGen) === false) return;
        append(xhr.__wcReq, xhr.responseText ?? "", true, xhr.status);
      });
    }
    return origSend.apply(this, args);
  };
  const origFetch = w.fetch.bind(w);
  w.fetch = function(input, init) {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const isChat = typeof url === "string" && url.includes("/chat/completion");
    const gen = w.__wcGen ?? 0;
    const req = w.__wcReqSeq = (w.__wcReqSeq ?? 0) + 1;
    return origFetch(input, init).then((response) => {
      if (!isChat || response === null || response === void 0) return response;
      const body = response.body;
      if (body === null || body === void 0 || typeof body.tee !== "function") return response;
      try {
        const [pageStream, captureStream] = body.tee();
        const decoder = new w.TextDecoder();
        const reader = captureStream.getReader();
        let captured = "";
        let complete = false;
        const flush = () => append(req, captured, complete, response.status);
        void (async () => {
          try {
            for (; ; ) {
              const { done, value } = await reader.read();
              if (done) break;
              captured += decoder.decode(value, { stream: true });
              if (current(gen)) flush();
            }
            captured += decoder.decode();
            complete = true;
            if (current(gen)) flush();
          } catch {
          }
        })();
        return new w.Response(pageStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch {
        return response;
      }
    });
  };
}
function stripSearchTrace(text2) {
  return text2.replace(/DEEP_SEARCH/g, "").replace(/FINISHED+/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
function previousReplyMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === void 0 || message.role !== "assistant") continue;
    const text2 = message.content.trimStart();
    if (text2 !== "") return text2;
  }
  return "";
}
function normalizeReplyText(text2) {
  return text2.replace(/<\/?(?:details|summary)[^>]*>/gi, "").replace(/[*_`~>#|]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}
var REPLICA_MIN_CHARS = 10;
var REPLICA_OVERLAP = 0.9;
function repeatsPreviousReply(scraped, previous) {
  if (previous === "") return false;
  const a = normalizeReplyText(previous);
  const b = normalizeReplyText(scraped);
  const shortest = Math.min(a.length, b.length);
  if (shortest < REPLICA_MIN_CHARS) return false;
  const overlap = a.startsWith(b) || b.startsWith(a) ? shortest : commonPrefixLength(a, b);
  return overlap / shortest >= REPLICA_OVERLAP;
}
function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}
function isThinkingType(type) {
  return typeof type === "string" && type.toUpperCase().includes("THINK");
}
function webMessagesToScraped(messages) {
  const out = [];
  for (const message of messages) {
    const fragments = Array.isArray(message.fragments) ? message.fragments : [];
    const textOf = (type) => fragments.filter((fragment) => fragment.type === type).map((fragment) => fragment.content ?? "").join("");
    if (message.role === "USER") {
      const attachments = fragments.filter((fragment) => fragment.type === "FILE").flatMap((fragment) => fragment.files ?? []).map((file) => (file.file_name ?? "").trim()).filter((name2) => name2 !== "");
      const body2 = textOf("REQUEST").trim();
      const content = [body2, ...attachments.map((name2) => `\uFF08\u9644\u4EF6\uFF1A${name2}\uFF09`)].filter((part) => part !== "").join("\n\n");
      if (content !== "") out.push({ role: "user", parts: [{ kind: "body", markdown: "", text: content }] });
      continue;
    }
    const parts = [];
    const thinking = renderThinking(fragments);
    if (thinking !== "") parts.push({ kind: "think", markdown: "", text: thinking });
    const body = normalizeCitations(textOf("RESPONSE").trim());
    if (body !== "") parts.push({ kind: "body", markdown: "", text: body });
    const sources = sourcesOf(
      fragments.filter((fragment) => fragment.type === "TOOL_SEARCH" || fragment.type === "SEARCH").flatMap((fragment) => Array.isArray(fragment.results) ? fragment.results : []).map((result) => {
        const entry = typeof result === "object" && result !== null ? result : {};
        const url = entry["url"];
        const title = entry["title"] ?? entry["name"];
        return {
          url: typeof url === "string" ? url : "",
          ...typeof title === "string" && title !== "" ? { title } : {}
        };
      })
    );
    if (parts.length > 0) out.push(sources === void 0 ? { role: "assistant", parts } : { role: "assistant", parts, sources });
  }
  return out;
}
function normalizeCitations(text2) {
  return text2.replace(/\[reference:(\d+)\]/g, "[citation:$1]");
}
function renderThinking(fragments) {
  let thinking = "";
  const opened = [];
  for (const fragment of fragments) {
    if (isThinkingType(fragment.type)) {
      thinking += fragment.content ?? "";
      continue;
    }
    if (fragment.type === "TOOL_SEARCH" || fragment.type === "SEARCH") {
      const count = Array.isArray(fragment.results) ? fragment.results.length : 0;
      const label = count > 0 ? `\u641C\u7D22\u5230 ${count} \u4E2A\u7F51\u9875` : fragment.content ?? "";
      const queries = (fragment.queries ?? []).map((query) => (query.query ?? "").trim()).filter((query) => query !== "");
      if (label !== "") {
        thinking += `

${label}${queries.length === 0 ? "" : `
${queries.map((query) => `- ${query}`).join("\n")}`}

`;
      }
      continue;
    }
    if (fragment.type === "TOOL_OPEN") {
      const title = fragment.result?.title;
      if (typeof title === "string" && title !== "") opened.push(title);
    }
  }
  if (opened.length > 0) thinking += `

\u6D4F\u89C8 ${opened.length} \u4E2A\u9875\u9762
${opened.map((title) => `- ${title}`).join("\n")}

`;
  return thinking.replace(/\n{3,}/g, "\n\n").trim();
}
function createStreamReplyParser() {
  let body = "";
  let thinking = "";
  let finished = false;
  let currentType = "RESPONSE";
  let pending = "";
  const searchResults = [];
  const openById = /* @__PURE__ */ new Map();
  let urlToIndex;
  const buildUrlIndex = () => {
    if (urlToIndex === void 0) {
      urlToIndex = /* @__PURE__ */ new Map();
      searchResults.forEach((source, i) => {
        if (source.url !== "" && !urlToIndex.has(source.url)) urlToIndex.set(source.url, i);
      });
    }
    return urlToIndex;
  };
  const resolveCitations = (text2, refs) => {
    if (!Array.isArray(refs) || refs.length === 0) return text2;
    let i = 0;
    return text2.replace(/\[reference:\d+\]/g, () => {
      const ref = refs[i];
      i++;
      if (typeof ref !== "object" || ref === null) return "";
      if (ref["type"] !== "TOOL_OPEN") return "";
      const id = ref["id"];
      const url = typeof id === "number" ? openById.get(id) : void 0;
      if (url === void 0) return "";
      const idx = buildUrlIndex().get(url);
      return idx === void 0 ? "" : `[citation:${idx + 1}]`;
    });
  };
  const appendContent = (text2) => {
    if (isThinkingType(currentType)) thinking += text2;
    else body += text2;
  };
  const appendFragments = (fragments) => {
    const opened = [];
    for (const frag of fragments) {
      if (typeof frag !== "object" || frag === null) continue;
      const f = frag;
      const type = f["type"];
      if (typeof type === "string") currentType = type;
      const content = f["content"];
      if (typeof content === "string" && content !== "") {
        if (isThinkingType(type)) thinking += content;
        else if (type === "RESPONSE" || type === "TEXT") body += content;
      }
      if (type === "TOOL_OPEN") {
        const result = f["result"];
        const title = result?.["title"];
        if (typeof title === "string" && title !== "") opened.push(title);
        const id = f["id"];
        const url = result?.["url"];
        if (typeof id === "number" && typeof url === "string" && url !== "") {
          openById.set(id, url);
        }
      }
    }
    if (opened.length > 0) {
      thinking += `

\u6D4F\u89C8 ${opened.length} \u4E2A\u9875\u9762
${opened.map((t) => `- ${t}`).join("\n")}

`;
    }
  };
  const applyBatchOps = (ops) => {
    let contentText = "";
    let hasContent = false;
    let refs = null;
    const fragmentsList = [];
    for (const item of ops) {
      if (typeof item !== "object" || item === null) continue;
      const it = item;
      const ip = it["p"];
      const iop = it["o"];
      const iv = it["v"];
      if (ip === "content" && iop === "APPEND" && typeof iv === "string") {
        contentText += iv;
        hasContent = true;
      } else if (ip === "references" && Array.isArray(iv)) {
        refs = iv;
      } else if (ip === "fragments" && iop === "APPEND" && Array.isArray(iv)) {
        fragmentsList.push(iv);
      }
    }
    for (const fr of fragmentsList) appendFragments(fr);
    if (hasContent) {
      if (isThinkingType(currentType)) thinking += contentText;
      else body += resolveCitations(contentText, refs);
    }
  };
  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "") return;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof obj !== "object" || obj === null) return;
    const o = obj;
    const v = o["v"];
    if (typeof v === "object" && v !== null && !Array.isArray(v) && "response" in v) {
      const resp = v["response"];
      const fragments = resp?.["fragments"];
      if (Array.isArray(fragments)) {
        let newBody = "";
        let newThinking = "";
        for (const frag of fragments) {
          if (typeof frag !== "object" || frag === null) continue;
          const f = frag;
          const type = f["type"];
          if (typeof type === "string") currentType = type;
          const content = f["content"];
          if (typeof content !== "string" || content === "") continue;
          if (isThinkingType(type)) newThinking += content;
          else if (type === "RESPONSE" || type === "TEXT") newBody += content;
        }
        if (newBody !== "") body = newBody;
        if (newThinking !== "") thinking = newThinking;
      }
      return;
    }
    const p = o["p"];
    const op = o["o"];
    if (p === "response/fragments" && op === "APPEND" && Array.isArray(v)) {
      appendFragments(v);
      return;
    }
    if (typeof p === "string") {
      if (typeof v === "string" && p === "response/fragments/-1/content" && op !== "SET") {
        appendContent(v);
      } else if (op === "SET" && p === "response/fragments/-1/results" && Array.isArray(v)) {
        for (const r of v) {
          if (typeof r === "object" && r !== null) {
            const entry = r;
            const url = entry["url"];
            if (typeof url === "string" && url !== "") {
              const title = entry["title"] ?? entry["name"];
              searchResults.push(typeof title === "string" && title !== "" ? { url, title } : { url });
            }
          }
        }
        urlToIndex = void 0;
        thinking += `

\u641C\u7D22\u5230 ${v.length} \u4E2A\u7F51\u9875

`;
      } else if (op === "SET" && p === "response/status" && v === "FINISHED") {
        finished = true;
      } else if (op === "BATCH" && Array.isArray(v)) {
        applyBatchOps(v);
      }
      return;
    }
    if (Array.isArray(v)) {
      applyBatchOps(v);
      return;
    }
    if (typeof v === "string") appendContent(v);
  };
  const snapshot = () => {
    const thinkMd = thinking.trim() === "" ? "" : `<details><summary>\u601D\u8003\u8FC7\u7A0B</summary>

${thinking.trim()}

</details>`;
    const markdown = [thinkMd, body.trim()].filter((s) => s !== "").join("\n\n");
    return { markdown, thinking, finished, sources: [...searchResults] };
  };
  return {
    push(chunk) {
      if (chunk === "") return;
      pending += chunk;
      const lastBreak = pending.lastIndexOf("\n");
      if (lastBreak < 0) return;
      const complete = pending.slice(0, lastBreak);
      pending = pending.slice(lastBreak + 1);
      for (const line of complete.split("\n")) consumeLine(line);
    },
    finish() {
      if (pending === "") return;
      const rest = pending;
      pending = "";
      consumeLine(rest);
    },
    snapshot
  };
}
var SerialQueue = class {
  tail = Promise.resolve();
  run(task) {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => void 0);
    return next;
  }
};
var DeepSeekWebEngine = class {
  store;
  config;
  profileDir;
  context;
  page;
  queue = new SerialQueue();
  state = "stopped";
  engineError;
  busy = false;
  /** Epoch ms when the current turn started (panel renders the elapsed timer). */
  busySince;
  lastError;
  lastErrorCode;
  /**
   * A "new chat" whose local transcript already exists but whose page work is
   * still on the serial queue. The panel switches immediately; `send` rides the
   * same queue, so it can never overtake this.
   */
  newChatPending = false;
  /** Set when that page work failed, so the next send refuses instead of misfiring. */
  newChatError;
  /**
   * True while a self-heal relaunch kicked off by `status()` is still running.
   *
   * `status()` must never await a launch (see its self-heal branch), so the
   * work runs in the background and this flag is what both keeps it to ONE
   * launch and lets the status view report 'launching' honestly meanwhile.
   */
  relaunchPending = false;
  /**
   * The launch currently in flight, if any.
   *
   * `ensureBrowser` used to answer a SECOND caller by polling for ten seconds
   * and then throwing 「浏览器启动超时」 — while one launch is
   * `launchPersistentContext` plus a 45 s `page.goto`, i.e. routinely longer
   * than that budget. Two callers reaching a cold engine (the panel waking it,
   * the `/state` self-heal, or a wake that overtook a send) therefore turned
   * into a spurious timeout on the second one. Holding the promise makes every
   * caller await the SAME launch and see its real outcome.
   */
  launchInFlight;
  launchedOnce = false;
  /**
   * True while a headed one-time login window is open.
   *
   * Cleared as soon as the page reports a session — but the page is no longer
   * closed at that moment (see `watchLogin`), because that close was half of the
   * "网页端启动了两次" report.
   */
  loginMode = false;
  /** Remembered login state — survives the auto-close so the panel stays "已登录". */
  loggedInOnce = false;
  /** Commanded toggle state (best-effort read-back overrides on status). */
  deepThink = false;
  search = false;
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.profileDir = config.profileDir ?? join(config.dataDir, "browser-profile");
  }
  /** Coarse state for status snapshots. */
  getState() {
    return this.state;
  }
  getEngineError() {
    return this.engineError;
  }
  getBusy() {
    return this.busy;
  }
  /** Epoch ms the current turn started, or undefined while idle. */
  getBusySince() {
    return this.busySince;
  }
  getLastError() {
    return this.lastError;
  }
  getLastErrorCode() {
    return this.lastErrorCode;
  }
  /** Set the last error + its structured code together (keeps them in sync). */
  setLastError(message, code) {
    this.lastError = message;
    this.lastErrorCode = code;
  }
  setState(next, error) {
    this.state = next;
    this.engineError = error;
  }
  /** Resolve a browser launch descriptor (executable + args). */
  launchOptions() {
    const args = [];
    const proxy = this.config.proxy ?? "direct";
    if (proxy === "direct") args.push("--no-proxy-server");
    else if (proxy.startsWith("http")) args.push(`--proxy-server=${proxy}`);
    if (this.config.executablePath !== void 0) return { executablePath: this.config.executablePath, args };
    if (this.config.channel !== void 0 && this.config.channel !== "auto") return { channel: this.config.channel, args };
    const candidates = [
      { channel: "chrome" },
      { channel: "msedge" },
      { channel: "chromium" },
      { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      { executablePath: "/usr/bin/google-chrome" },
      { executablePath: "/usr/bin/google-chrome-stable" },
      { executablePath: "/usr/bin/microsoft-edge" },
      { executablePath: "/usr/bin/chromium" },
      { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
      { executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" }
    ];
    return { ...candidates[0], args };
  }
  /** True when the cached page/context are still connected (not closed by the user). */
  isPageAlive() {
    if (this.page === void 0 || this.context === void 0) return false;
    try {
      return !this.page.isClosed();
    } catch {
      return false;
    }
  }
  /**
   * True when this browser profile has been used before — i.e. it plausibly
   * holds a DeepSeek session.
   *
   * It exists to keep the FIRST run to a single browser launch. A login needs a
   * visible window and a visible window cannot be produced by a browser that is
   * already running, so "launch headless, discover /sign_in, relaunch headed"
   * costs a first-time reader two launches for one login. An empty profile dir
   * settles the question before the first launch: nothing to reuse, so go
   * straight to the login window. A profile that HAS run before is the opposite
   * case — it is very likely still authenticated, and waking it headless is
   * both faster and invisible.
   */
  hasProfileData() {
    const marks = [
      join(this.profileDir, "Default", "Cookies"),
      join(this.profileDir, "Cookies"),
      join(this.profileDir, "Default", "Local Storage")
    ];
    return marks.some((mark) => {
      try {
        return existsSync(mark);
      } catch {
        return false;
      }
    });
  }
  /**
   * Ensure the browser + chat.deepseek.com page exist. Launches the persistent
   * context on first call; subsequent calls reuse the page.
   *
   * Concurrent callers share ONE launch (see `launchInFlight`): this method is
   * reached from three directions at once — the panel waking the engine, the
   * `/state` self-heal, and a send — and each of them used to be able to start
   * its own browser.
   */
  async ensureBrowser() {
    if (this.isPageAlive()) return this.page;
    if (this.launchInFlight !== void 0) return await this.launchInFlight;
    const task = this.launchBrowser();
    this.launchInFlight = task;
    try {
      return await task;
    } finally {
      if (this.launchInFlight === task) this.launchInFlight = void 0;
    }
  }
  /** The launch itself: pick a browser, open the chat page, report 'ready'. */
  async launchBrowser() {
    if (this.page !== void 0 || this.context !== void 0) await this.disposeBrowser();
    this.setState("launching");
    try {
      mkdirSync(this.profileDir, { recursive: true, mode: 448 });
      const options = this.launchOptions();
      const attemptOrder = this.config.executablePath !== void 0 || this.config.channel !== void 0 && this.config.channel !== "auto" ? [options] : this.launchOptionsCandidates();
      let lastError;
      for (const attempt of attemptOrder) {
        try {
          this.context = await chromium.launchPersistentContext(this.profileDir, {
            ...attempt,
            // The one-time login window must be visible; normal (chat) launches
            // are headless by default so the browser stays out of the way.
            headless: this.loginMode ? false : this.config.headless ?? true,
            viewport: null,
            args: options.args
          });
          lastError = void 0;
          break;
        } catch (error) {
          lastError = error;
          await this.disposeBrowser();
        }
      }
      if (lastError !== void 0) {
        if (isShutdownError(lastError)) {
          this.setState("stopped");
          throw lastError;
        }
        this.setState("error", `\u65E0\u6CD5\u542F\u52A8\u6D4F\u89C8\u5668\uFF08\u8BF7\u68C0\u67E5 Chrome/Edge \u662F\u5426\u5DF2\u5B89\u88C5\uFF0C\u6216\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u6307\u5B9A\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF09: ${String(lastError)}`);
        throw new Error(this.engineError);
      }
      const pages = this.context.pages();
      this.page = pages[0] ?? await this.context.newPage();
      this.page.setDefaultTimeout(15e3);
      await this.page.addInitScript(streamCaptureInit);
      await this.openDeepSeekPage();
      this.setState("ready");
      this.launchedOnce = true;
      return this.page;
    } catch (error) {
      if (isShutdownError(error)) {
        if (this.state !== "stopped") {
          await this.disposeBrowser().catch(() => void 0);
          this.setState("stopped");
        }
      } else if (this.state !== "error") {
        this.setState("error", String(error));
      }
      throw error;
    }
  }
  /** The candidate list used during auto-detection. */
  launchOptionsCandidates() {
    const all = [
      { channel: "chrome" },
      { channel: "msedge" },
      { channel: "chromium" },
      { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      { executablePath: "/usr/bin/google-chrome" },
      { executablePath: "/usr/bin/google-chrome-stable" },
      { executablePath: "/usr/bin/microsoft-edge" },
      { executablePath: "/usr/bin/chromium" },
      { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
      { executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" }
    ];
    return all.filter((candidate) => {
      if (candidate.channel !== void 0) return true;
      return candidate.executablePath !== void 0 && existsSync(candidate.executablePath);
    });
  }
  /** Navigate to the DeepSeek chat root. */
  async openDeepSeekPage() {
    if (this.page === void 0) throw new Error("\u6D4F\u89C8\u5668\u5C1A\u672A\u542F\u52A8");
    const baseUrl = this.config.baseUrl ?? "https://chat.deepseek.com";
    try {
      await this.page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45e3 });
      await this.page.waitForTimeout(2500);
    } catch (error) {
      if (isShutdownError(error)) {
        await this.disposeBrowser();
        this.setState("stopped");
        throw error instanceof Error ? error : new Error(String(error));
      }
      this.setState("error", `\u65E0\u6CD5\u6253\u5F00 ${baseUrl}\uFF1A${String(error)}`);
      throw new Error(this.engineError);
    }
  }
  /** True when the page shows the chat UI (not the login page). */
  async isLoggedIn() {
    if (!this.isPageAlive()) return null;
    try {
      const url = this.page.url();
      if (url.includes("/sign_in") || url.includes("/auth")) return false;
      const hasComposer = await this.page.locator("textarea").count().then((count) => count > 0).catch(() => false);
      return hasComposer;
    } catch {
      return null;
    }
  }
  /**
   * Bring the web page up for a reader who wants to type — WITHOUT assuming a
   * login window is what they need.
   *
   * This is what the panel calls when the composer is clicked or a message is
   * submitted while the engine is down. It is deliberately NOT `openLoginWindow`:
   * a profile that is already authenticated only needs a browser, and asking for
   * the visible login window first is what made one click cost two launches —
   * the window opened (headed, disposing whatever was running), saw the
   * persisted session, closed itself again, and the following send had to launch
   * a second, headless browser to do the actual work.
   *
   * So the wake is one launch in the right mode:
   *   - a live page is reused, never relaunched;
   *   - a profile with no history at all goes straight to the visible login
   *     window (there is nothing to reuse, and a login needs a human);
   *   - everything else wakes headless per the browser settings, and only a page
   *     that reports /sign_in escalates to the visible window afterwards.
   *
   * Serialized on the engine queue: a wake may dispose and relaunch a browser,
   * which must never happen while a send is typing into the old one.
   */
  async wake() {
    return this.queue.run(async () => {
      if (this.isPageAlive()) {
        const loggedIn2 = await this.isLoggedIn();
        if (loggedIn2 === true) this.loggedInOnce = true;
        return { ok: true, loggedIn: loggedIn2, launched: false };
      }
      if (!this.loggedInOnce && !this.hasProfileData()) {
        if (this.page !== void 0 || this.context !== void 0) await this.disposeBrowser();
        this.loginMode = true;
      }
      try {
        await this.ensureBrowser();
      } catch (error) {
        this.loginMode = false;
        return { ok: false, error: String(error), loggedIn: null, launched: false };
      }
      const loggedIn = await this.isLoggedIn();
      if (loggedIn === true) {
        this.loggedInOnce = true;
        this.loginMode = false;
        return { ok: true, loggedIn: true, launched: true };
      }
      if (this.loginMode) {
        void this.watchLogin();
        return { ok: true, loggedIn: false, launched: true, loginWindow: true };
      }
      return { ok: true, loggedIn, launched: true };
    });
  }
  /**
   * Open a visible browser window for the one-time login (the panel's explicit
   * 「打开登录窗口」, and the escalation a wake takes when it finds /sign_in).
   *
   * Idempotent and non-destructive on purpose:
   *   - a live page that is ALREADY logged in is reused and brought forward. The
   *     old version disposed it first, so a click that raced a stale "not logged
   *     in" snapshot tore down a perfectly good browser and relaunched it —
   *     the worst form of the double launch;
   *   - a login window that is already open is reused too, so a second click
   *     (or a second panel) cannot spawn a second browser;
   *   - only a page that genuinely cannot log in — the sign-in screen itself, or
   *     no page at all — is replaced by a fresh headed window.
   */
  async openLoginWindow() {
    return this.queue.run(() => this.openLoginInner());
  }
  /** The queued-open form: `wake` already runs on the queue and calls this. */
  async openLoginInner() {
    if (this.isPageAlive()) {
      if (this.loginMode) {
        await this.page?.bringToFront().catch(() => void 0);
        return { ok: true, loggedIn: false, launched: false, loginWindow: true, reused: true };
      }
      if (await this.isLoggedIn() === true) {
        this.loggedInOnce = true;
        await this.page?.bringToFront().catch(() => void 0);
        return { ok: true, loggedIn: true, launched: false, reused: true };
      }
    }
    try {
      if (this.page !== void 0 || this.context !== void 0) await this.disposeBrowser();
      this.loginMode = true;
      await this.ensureBrowser();
      await this.page?.bringToFront().catch(() => void 0);
      void this.watchLogin();
      return { ok: true, loggedIn: false, launched: true, loginWindow: true };
    } catch (error) {
      this.loginMode = false;
      return { ok: false, error: String(error), loggedIn: null, launched: false };
    }
  }
  /**
   * Poll a login window and mark the engine ready once the user has signed in.
   *
   * It used to CLOSE the browser at that moment, and that single line is the
   * other half of the "网页端又启动了一次" report: the next send found no page
   * and launched a fresh (headless) browser, so one login cost two launches and
   * threw away a page that was already sitting on the chat UI, authenticated.
   * The page is KEPT — the next send types straight into it. 「关闭浏览器」 in the
   * panel's ··· menu is how a reader gets rid of the visible window.
   */
  async watchLogin() {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (!this.loginMode) return;
      if (!this.isPageAlive()) {
        this.loginMode = false;
        if (this.state !== "error") this.setState("stopped");
        return;
      }
      if (await this.isLoggedIn() === true) {
        this.loginMode = false;
        this.loggedInOnce = true;
        this.setState("ready");
        return;
      }
      await new Promise((resolve2) => setTimeout(resolve2, 1e3));
    }
  }
  /** Current page URL (for status/debug). */
  pageUrl() {
    if (!this.isPageAlive()) return void 0;
    try {
      return this.page?.url();
    } catch {
      return void 0;
    }
  }
  /**
   * Best-effort read of the deep-think (R1) and search toggle state from the
   * page. The toggles are `div.ds-toggle-button` elements (NOT `<button>`)
   * carrying `aria-pressed` plus a `ds-toggle-button--selected` class when on;
   * the search toggle is labeled 智能搜索. Falls back to the last commanded
   * state when the page gives no clear signal.
   */
  async readToggles() {
    if (!this.isPageAlive()) return { deepThink: this.deepThink, search: this.search };
    try {
      const pageState = await this.page.evaluate(() => {
        const read = (candidates) => {
          for (const el of Array.from(document.querySelectorAll("[aria-pressed]"))) {
            const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
            if (!candidates.some((candidate) => label.includes(candidate))) continue;
            const pressed = el.getAttribute("aria-pressed");
            if (pressed === "true") return true;
            if (pressed === "false") return false;
            const cls = typeof el.className === "string" ? el.className : "";
            if (/ds-toggle-button--selected|--selected|active|checked/i.test(cls)) return true;
          }
          return void 0;
        };
        return {
          deepThink: read(["\u6DF1\u5EA6\u601D\u8003", "DeepThink", "Deep Think", "R1"]),
          search: read(["\u667A\u80FD\u641C\u7D22", "\u8054\u7F51\u641C\u7D22", "\u641C\u7D22", "Search"])
        };
      });
      return {
        deepThink: pageState.deepThink ?? this.deepThink,
        search: pageState.search ?? this.search
      };
    } catch {
      return { deepThink: this.deepThink, search: this.search };
    }
  }
  /** Serialized page evaluation guarded against a dead page. */
  async evalPage(fn) {
    if (this.page === void 0) throw new Error("\u6D4F\u89C8\u5668\u5C1A\u672A\u542F\u52A8");
    return this.page.evaluate(fn);
  }
  /**
   * In-page scraper: returns the ordered rendered messages currently in the
   * DOM. Uses the virtual-list item keys as message boundaries and the
   * assistant-main-content class to split roles. Fallback only — the primary
   * reply source is the teed SSE stream.
   */
  /**
   * The message-list item keys currently mounted in the page.
   *
   * `[data-virtual-list-item-key]` is the app's virtualizer key, and it is the
   * one stable per-message identity the DOM offers (the surrounding class names
   * are hashed and churn on every deploy). Comparing the set before a send with
   * the set after it answers the only question the DOM fallback has to get
   * right: has this turn's reply appeared yet, or is this still the last turn's?
   */
  async messageKeys() {
    if (this.page === void 0) return [];
    return await this.page.evaluate((selector) => {
      const keys = [];
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const key = element.getAttribute("data-virtual-list-item-key") ?? "";
        if (key !== "") keys.push(key);
      }
      return keys;
    }, WEB_MESSAGE_ITEM_SELECTOR).catch(() => []);
  }
  async scrapeConversation() {
    if (this.page === void 0) return [];
    const raw = await this.page.evaluate((itemSelector) => {
      const extract = (element) => {
        const clone = element.cloneNode(true);
        for (const junk of clone.querySelectorAll('.ds-markdown-code-copy-button, button, svg, [class*="copy"]')) {
          junk.remove();
        }
        return { markdown: clone.innerHTML, text: clone.innerText };
      };
      const out = [];
      const items = document.querySelectorAll(itemSelector);
      for (const item of Array.from(items)) {
        const assistant = item.querySelector(".ds-assistant-message-main-content");
        const think = item.querySelector(".ds-think-content");
        const body = assistant === null ? item.querySelector(".ds-markdown") : assistant.classList.contains("ds-markdown") ? assistant : assistant.querySelector(".ds-markdown");
        if (assistant !== null || think !== null || body !== null) {
          const parts = [];
          if (think !== null) parts.push({ kind: "think", ...extract(think) });
          if (body !== null) parts.push({ kind: "body", ...extract(body) });
          if (parts.length > 0) out.push({ role: "assistant", parts });
        } else {
          const clone = item.cloneNode(true);
          for (const junk of clone.querySelectorAll('button, svg, [class*="copy"]')) {
            junk.remove();
          }
          const text2 = (clone.innerText ?? "").trim();
          if (text2 !== "") out.push({ role: "user", parts: [{ kind: "body", markdown: "", text: text2 }] });
        }
      }
      return out;
    }, WEB_MESSAGE_ITEM_SELECTOR);
    return raw;
  }
  /** Convert scraped DOM messages into transcript messages (markdown content). */
  scrapedToMessages(scraped) {
    return scraped.map((message) => {
      if (message.role === "user") {
        const text2 = message.parts.map((part) => part.text).join("\n\n").trim();
        return { id: randomUUID(), role: "user", content: text2 === "" ? "\uFF08\u65E0\u5185\u5BB9\uFF09" : text2, ts: Date.now() };
      }
      const think = message.parts.filter((part) => part.kind === "think").map((part) => part.text).join("\n\n").trim();
      const body = message.parts.filter((part) => part.kind === "body").map((part) => part.markdown === "" ? part.text : serializeToMarkdown(parseMarkup(part.markdown))).join("\n\n").trim();
      const thinkMd = think === "" ? "" : `<details><summary>\u601D\u8003\u8FC7\u7A0B</summary>

${think}

</details>`;
      const content = [thinkMd, body].filter(Boolean).join("\n\n");
      return message.sources === void 0 ? { id: randomUUID(), role: "assistant", content, ts: Date.now() } : { id: randomUUID(), role: "assistant", content, ts: Date.now(), sources: message.sources };
    });
  }
  /**
   * List the web sidebar's conversations with the session id each row links to.
   *
   * The id comes from the row's own `/a/chat/s/<id>` href — the routing
   * contract the site cannot rename without breaking its deep links — and is
   * the only reliable identity: titles repeat, get truncated at 80 chars, and
   * a `hasText` match against one is a substring match ("你好" also matches
   * "你好问候").
   */
  /**
   * The web sidebar, read on the serial queue.
   *
   * Reading it is a page operation that can also LAUNCH the browser (below), so
   * it must not overlap a send that is typing into the composer — see
   * `ensureBrowser`: a launch disposes the current context, which would take the
   * half-typed message with it. Queued here, unqueued in the private inner form
   * so `recoverWebConversation` can call it without deadlocking on a queue that
   * is not re-entrant.
   */
  async listWebConversations() {
    return this.queue.run(() => this.listWebConversationsInner());
  }
  async listWebConversationsInner() {
    if (this.page === void 0) {
      try {
        await this.ensureBrowser();
      } catch {
        return [];
      }
    }
    if (this.page === void 0) return [];
    const rows = await this.page.evaluate((selector) => {
      const found = [];
      const seen = /* @__PURE__ */ new Set();
      for (const el of Array.from(document.querySelectorAll(selector))) {
        const text2 = (el.textContent ?? "").trim().replace(/\s+/g, " ");
        if (text2.length < 1 || text2.length > 80) continue;
        const href = el.getAttribute("href") ?? "";
        const id = href.split("/a/chat/s/")[1]?.split(/[/?#]/)[0]?.trim() ?? "";
        const key = id === "" ? `title:${text2}` : `id:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(id === "" ? { title: text2 } : { title: text2, sessionId: id });
      }
      return found.slice(0, 200);
    }, WEB_CHAT_LINK_SELECTOR).catch(() => []);
    return rows;
  }
  /**
   * Recover a web conversation into the local transcript store.
   *
   * Three sources, tried in order of fidelity and speed (the old
   * implementation had only the last one, which is why recovery was slow AND
   * short — the transcript is a virtualised list, so reading the DOM once
   * returns just the few rows around the viewport):
   *
   *   1. `history-api` — the page's own authenticated history endpoint. One
   *      request returns the whole conversation as fragments (markdown answer
   *      + reasoning + attachments), in ~100-300ms.
   *   2. `page-cache`   — the app's persisted IndexedDB cache, read after
   *      opening a conversation the app had not cached yet.
   *   3. `dom`          — open the conversation and harvest EVERY row of the
   *      virtual list by walking its scroller from top to bottom.
   *
   * The result is upserted into the store, so re-recovering a conversation
   * that was imported short (by an older version) repairs it in place instead
   * of being skipped as a duplicate.
   */
  async recoverWebConversation(query) {
    return this.queue.run(() => this.recoverWebConversationInner(query));
  }
  async recoverWebConversationInner(query) {
    const asked = typeof query === "string" ? { title: query } : query;
    const askedTitle = asked.title?.trim() ?? "";
    const askedId = asked.sessionId?.trim() ?? "";
    if (askedTitle === "" && askedId === "") return { ok: false, error: "\u7F3A\u5C11 title \u6216 sessionId" };
    if (this.page === void 0) {
      try {
        await this.ensureBrowser();
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
    if (await this.isLoggedIn() !== true) {
      return { ok: false, error: "\u5C1A\u672A\u767B\u5F55 DeepSeek \u7F51\u9875\u7AEF" };
    }
    try {
      let sessionId = askedId;
      let title = askedTitle;
      if (sessionId === "" || title === "") {
        const rows = await this.listWebConversationsInner();
        const match = sessionId !== "" ? rows.find((row) => row.sessionId === sessionId) : rows.find((row) => row.title === title) ?? rows.find((row) => row.title.includes(title));
        if (match === void 0) return { ok: false, error: `\u672A\u5728\u7F51\u9875\u7AEF\u627E\u5230\u4F1A\u8BDD\u300C${askedTitle === "" ? askedId : askedTitle}\u300D` };
        sessionId = sessionId !== "" ? sessionId : match.sessionId ?? "";
        title = title !== "" ? title : match.title;
      }
      let scraped = [];
      let source = "history-api";
      let apiMessages = -1;
      if (sessionId !== "") {
        const history = await this.fetchWebHistory(sessionId);
        if (history !== void 0) {
          apiMessages = history.messages.length;
          scraped = webMessagesToScraped(history.messages);
          if (title === "") title = history.title ?? "";
        }
      }
      if (apiMessages === 0) {
        return {
          ok: false,
          sessionId: sessionId === "" ? void 0 : sessionId,
          error: `\u300C${title}\u300D\u5728\u7F51\u9875\u7AEF\u8FD8\u6CA1\u6709\u4EFB\u4F55\u6D88\u606F\uFF08\u7A7A\u4F1A\u8BDD\uFF09\uFF0C\u6CA1\u6709\u53EF\u6062\u590D\u7684\u5185\u5BB9\u3002`
        };
      }
      if (scraped.length === 0 && sessionId !== "") {
        source = "page-cache";
        const cached = await this.readCachedWebHistory(sessionId);
        if (cached !== void 0) {
          scraped = webMessagesToScraped(cached.messages);
          if (title === "") title = cached.title ?? "";
        }
      }
      if (scraped.length === 0) {
        if (this.busy) return { ok: false, error: "\u6B63\u5728\u7B49\u5F85\u7F51\u9875\u7AEF\u56DE\u590D\uFF0C\u6682\u65F6\u4E0D\u80FD\u6253\u5F00\u4F1A\u8BDD\uFF1B\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u5148\u505C\u6B62\u751F\u6210\u3002" };
        const opened = await this.openWebConversation(sessionId, title);
        if (!opened.ok) return { ok: false, error: opened.error };
        sessionId = sessionId !== "" ? sessionId : opened.sessionId ?? "";
        if (sessionId !== "") {
          const cached = await this.waitForCachedWebHistory(sessionId);
          if (cached !== void 0) {
            source = "page-cache";
            scraped = webMessagesToScraped(cached.messages);
            if (title === "") title = cached.title ?? "";
          }
        }
      }
      if (scraped.length === 0) {
        source = "dom";
        scraped = await this.harvestConversation();
      }
      if (scraped.length === 0) {
        const probe = await this.probePage();
        return {
          ok: false,
          sessionId: sessionId === "" ? void 0 : sessionId,
          error: `\u672A\u80FD\u8BFB\u5230\u300C${title}\u300D\u7684\u6D88\u606F\u5185\u5BB9\uFF1A\u63A5\u53E3\u3001\u9875\u9762\u7F13\u5B58\u4E0E\u9875\u9762\u6293\u53D6\u4E09\u79CD\u6765\u6E90\u90FD\u662F\u7A7A\u7684\u3002\u9875\u9762\u505C\u5728 ${String(probe.url ?? "\u672A\u77E5\u5730\u5740")}\uFF0C\u6D88\u606F\u8282\u70B9 ${String(probe.messageItemCount ?? "?")} \u4E2A\u3001markdown ${String(probe.markdownCount ?? "?")} \u4E2A\u3002` + (probe.messageItemCount === 0 ? "\u8BE5\u4F1A\u8BDD\u5728\u7F51\u9875\u7AEF\u53EF\u80FD\u786E\u5B9E\u662F\u7A7A\u7684\uFF08\u6CA1\u6709\u5386\u53F2\u6D88\u606F\uFF09\u3002" : "\u4F1A\u8BDD\u5DF2\u6253\u5F00\u4F46\u6CA1\u6709\u53EF\u8BFB\u5185\u5BB9\u3002")
        };
      }
      const messages = this.scrapedToMessages(scraped);
      const model = this.deepThink ? "deepseek-reasoner" : "deepseek-chat";
      const result = this.store.importTranscript({
        title: title === "" ? "\u672A\u547D\u540D\u7F51\u9875\u4F1A\u8BDD" : title,
        model,
        messages,
        ...sessionId === "" ? {} : { webSessionId: sessionId },
        /*
         * The one caller allowed to match by title: this IS a re-sync of a
         * conversation the web sidebar named, and the DOM-scraped layer has no
         * session id to match on. Everywhere else a title is not an identity —
         * see TranscriptStore.importTranscript.
         */
        matchByTitle: true
      });
      return {
        ok: true,
        chatId: result.chat.id,
        title: result.chat.title,
        ...sessionId === "" ? {} : { sessionId },
        created: result.created,
        updated: result.updated,
        messageCount: messages.length,
        source
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
  /** `https://chat.deepseek.com` — the origin every page read must run on. */
  origin() {
    return (this.config.baseUrl ?? "https://chat.deepseek.com").replace(/\/+$/, "");
  }
  /**
   * Read the whole conversation through the page's OWN history endpoint.
   *
   * This is not an out-of-band API client: it is the same GET the app itself
   * issues on open, made from the app's own page, authorised with the app's
   * own token from `localStorage.userToken`. Omitting the cache parameters
   * makes the server answer with the full message list (`cache_control:
   * REPLACE`) instead of the delta it sends a warm client. Failure is
   * deliberately silent — every caller falls through to the cache, then to the
   * DOM.
   */
  async fetchWebHistory(sessionId) {
    if (!this.isPageAlive()) return void 0;
    try {
      if (!this.page.url().startsWith(this.origin())) {
        await this.openDeepSeekPage();
      }
      const result = await this.page.evaluate(async (sid) => {
        try {
          const raw = localStorage.getItem("userToken");
          const token = raw === null ? "" : JSON.parse(raw)?.value ?? "";
          const response = await fetch(`/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sid)}`, {
            credentials: "include",
            headers: token === "" ? {} : { authorization: `Bearer ${token}` }
          });
          if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
          const payload = await response.json();
          const biz = payload?.data?.biz_data;
          if (payload?.code !== 0 || biz === void 0 || biz === null) {
            return { ok: false, error: `code ${String(payload?.code)} ${String(payload?.msg ?? "")}`.trim() };
          }
          return { ok: true, title: String(biz?.chat_session?.title ?? ""), messages: biz?.chat_messages ?? [] };
        } catch (error) {
          return { ok: false, error: String(error) };
        }
      }, sessionId);
      if (!result.ok) return void 0;
      return { title: result.title, messages: result.messages };
    } catch {
      return void 0;
    }
  }
  /**
   * Read one conversation from the app's own IndexedDB cache (`deepseek-chat`
   * → `history-message`). The app writes the full message list there as it
   * loads a conversation, so this is a complete source without any navigation
   * — and the fallback when the history endpoint is unavailable.
   *
   * The database is opened WITHOUT a version on purpose: `indexedDB.open` on a
   * name that does not exist yet would CREATE an empty database, and the app
   * opening that same version later would find no object store. The existence
   * check first keeps this strictly read-only.
   */
  async readCachedWebHistory(sessionId) {
    if (!this.isPageAlive()) return void 0;
    try {
      if (!this.page.url().startsWith(this.origin())) return void 0;
      const result = await this.page.evaluate(async (sid) => {
        try {
          const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
          if (!databases.some((database) => database.name === "deepseek-chat")) return void 0;
          const handle = await new Promise((resolve2, reject) => {
            const request = indexedDB.open("deepseek-chat");
            request.onsuccess = () => resolve2(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            if (!handle.objectStoreNames.contains("history-message")) return void 0;
            const record = await new Promise((resolve2, reject) => {
              const tx = handle.transaction("history-message", "readonly");
              const request = tx.objectStore("history-message").get(sid);
              request.onsuccess = () => resolve2(request.result ?? void 0);
              request.onerror = () => reject(request.error);
            });
            const messages = record?.data?.chat_messages;
            if (!Array.isArray(messages)) return void 0;
            return { title: String(record?.data?.chat_session?.title ?? ""), messages };
          } finally {
            handle.close();
          }
        } catch {
          return void 0;
        }
      }, sessionId);
      if (result === void 0) return void 0;
      return { title: result.title, messages: result.messages };
    } catch {
      return void 0;
    }
  }
  /**
   * Poll the app's cache until the conversation lands in it (or time out).
   *
   * Short on purpose: the app writes the record as it paints the transcript
   * (measured ~1.2s for a conversation it had never seen), and the DOM harvest
   * is waiting behind this as the next tier — a long poll here would only make
   * the fallback slower.
   */
  async waitForCachedWebHistory(sessionId, timeoutMs = 3e3) {
    const deadline = Date.now() + timeoutMs;
    for (; ; ) {
      const cached = await this.readCachedWebHistory(sessionId);
      if (cached !== void 0 && cached.messages.length > 0) return cached;
      if (Date.now() >= deadline) return void 0;
      await new Promise((resolve2) => setTimeout(resolve2, 200));
    }
  }
  /**
   * Harvest EVERY message the page can render, not just the mounted ones.
   *
   * `[data-virtual-list-item-key]` is a virtualiser: only the rows near the
   * viewport exist in the DOM, so one `querySelectorAll` returns a handful of
   * messages no matter how long the conversation is. (Measured: a 16-message
   * conversation had exactly 2 rows mounted.) Recovering from the DOM without
   * this walk is why an import came back as "the last two messages" — the
   * reported "恢复的内容很短".
   *
   * The walk goes TOP-DOWN, not bottom-up, and that ordering is the whole
   * trick:
   *   - anchoring at the top is what makes the app page in the OLDEST messages,
   *     so the list's total height is final before the walk begins;
   *   - walking downward then never re-anchors the virtualiser (walking upward
   *     does, and lost up to half the rows in testing: 28/32, once 2/32).
   * A gap repair pass then revisits whatever the coarse steps skipped, using
   * the scroll offset each neighbouring key was seen at.
   *
   * Slower than the history endpoint by an order of magnitude — which is
   * exactly why it is the last resort — but it is complete, and it needs
   * nothing but the DOM.
   */
  async harvestConversation() {
    if (!this.isPageAlive()) return [];
    try {
      return await this.page.evaluate(async (itemSelector) => {
        const sleep = (ms) => new Promise((resolve2) => window.setTimeout(resolve2, ms));
        const settle = async () => {
          await Promise.race([
            new Promise((resolve2) => {
              let frames = 0;
              const tick = () => {
                frames += 1;
                if (frames >= 2) resolve2();
                else window.requestAnimationFrame(tick);
              };
              window.requestAnimationFrame(tick);
            }),
            sleep(60)
          ]);
          await sleep(8);
        };
        const extract = (element) => {
          const clone = element.cloneNode(true);
          for (const junk of clone.querySelectorAll('.ds-markdown-code-copy-button, button, svg, [class*="copy"]')) {
            junk.remove();
          }
          return { markdown: clone.innerHTML, text: clone.innerText };
        };
        const readRow = (item) => {
          const assistant = item.querySelector(".ds-assistant-message-main-content");
          const think = item.querySelector(".ds-think-content");
          const body = assistant === null ? item.querySelector(".ds-markdown") : assistant.classList.contains("ds-markdown") ? assistant : assistant.querySelector(".ds-markdown");
          if (assistant !== null || think !== null || body !== null) {
            const parts = [];
            if (think !== null) parts.push({ kind: "think", ...extract(think) });
            if (body !== null) parts.push({ kind: "body", ...extract(body) });
            return parts.length === 0 ? null : { role: "assistant", parts };
          }
          const clone = item.cloneNode(true);
          for (const junk of clone.querySelectorAll('button, svg, [class*="copy"]')) junk.remove();
          const text2 = (clone.innerText ?? "").trim();
          return text2 === "" ? null : { role: "user", parts: [{ kind: "body", markdown: "", text: text2 }] };
        };
        const mounted = Array.from(document.querySelectorAll(itemSelector));
        let scroller = null;
        if (mounted.length > 0) {
          let common = mounted[0];
          for (const row of mounted.slice(1)) {
            while (common !== null && !common.contains(row)) common = common.parentElement;
          }
          let element = common;
          while (element !== null && element !== document.body) {
            const style = getComputedStyle(element);
            if (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 4) {
              scroller = element;
              break;
            }
            element = element.parentElement;
          }
        }
        const harvest = /* @__PURE__ */ new Map();
        const seenAt = /* @__PURE__ */ new Map();
        const sizeOf = (message) => message.parts.reduce((total, part) => total + part.text.length + part.markdown.length, 0);
        const better = (candidate, previous) => {
          if (candidate.role !== previous.role) return candidate.role === "assistant";
          return sizeOf(candidate) > sizeOf(previous);
        };
        const sweep = () => {
          const top = scroller === null ? 0 : scroller.scrollTop;
          for (const item of Array.from(document.querySelectorAll(itemSelector))) {
            const key = item.getAttribute("data-virtual-list-item-key");
            if (key === null) continue;
            const message = readRow(item);
            if (message === null) continue;
            const previous = harvest.get(key);
            if (previous === void 0 || better(message, previous)) {
              harvest.set(key, message);
              if (!seenAt.has(key)) seenAt.set(key, top);
            }
          }
        };
        sweep();
        if (scroller === null) return Array.from(harvest.values());
        const initialScrollTop = scroller.scrollTop;
        const started = performance.now();
        const viewport = Math.max(120, scroller.clientHeight);
        const budgetMs = 25e3;
        const scrollTo = async (top) => {
          const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = Math.max(0, Math.min(top, max));
          await settle();
          sweep();
        };
        await scrollTo(0);
        for (let round = 0; round < 3; round++) {
          const before = harvest.size;
          await scrollTo(0);
          if (harvest.size === before) break;
        }
        const step = viewport * 2;
        let steps = 0;
        for (let top = 0; top <= scroller.scrollHeight + step && steps < 400; top += step) {
          if (performance.now() - started > budgetMs) break;
          steps += 1;
          await scrollTo(top);
        }
        await scrollTo(scroller.scrollHeight);
        const keyNumbers = Array.from(harvest.keys()).map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
        if (keyNumbers.length > 1) {
          const missing = [];
          for (let id = keyNumbers[0]; id <= keyNumbers[keyNumbers.length - 1]; id++) {
            if (!harvest.has(String(id))) missing.push(id);
          }
          const fine = Math.max(60, viewport * 0.35);
          for (const id of missing) {
            if (performance.now() - started > budgetMs) break;
            const below = keyNumbers.filter((value) => value < id).pop();
            const above = keyNumbers.find((value) => value > id);
            const from = below === void 0 ? 0 : seenAt.get(String(below)) ?? 0;
            const to = above === void 0 ? scroller.scrollHeight : seenAt.get(String(above)) ?? scroller.scrollHeight;
            for (let top = from; top <= to + fine; top += fine) {
              if (performance.now() - started > budgetMs) break;
              await scrollTo(top);
            }
          }
        }
        scroller.scrollTop = initialScrollTop;
        const entries = Array.from(harvest.entries());
        const numeric = entries.every(([key]) => Number.isFinite(Number(key)));
        if (numeric) entries.sort((a, b) => Number(a[0]) - Number(b[0]));
        return entries.map(([, message]) => message);
      }, WEB_MESSAGE_ITEM_SELECTOR);
    } catch {
      return [];
    }
  }
  /**
   * Open a web conversation so the page loads (and caches) it.
   *
   * With a session id this is a plain `goto` of the conversation's own deep
   * link — deterministic, and the same page the SPA would have rendered. The
   * click-first dance is kept only for the id-less fallback (markup changed),
   * where a swallowed click used to leave the page on the chat root and the
   * scrape returning zero messages.
   */
  async openWebConversation(sessionId, title) {
    if (this.page === void 0) return { ok: false, error: "\u6D4F\u89C8\u5668\u672A\u542F\u52A8" };
    const conversationIn = () => {
      const match = /\/a\/chat\/s\/([^/?#]+)/.exec(this.page.url());
      return match?.[1];
    };
    if (sessionId !== "") {
      const target2 = `${this.origin()}/a/chat/s/${sessionId}`;
      if (!this.page.url().startsWith(target2)) {
        await this.page.goto(target2, { waitUntil: "domcontentloaded", timeout: 3e4 }).catch(() => void 0);
      }
      await this.waitForTranscriptPaint();
      const landed = conversationIn();
      if (landed === void 0) {
        return { ok: false, error: `\u6253\u5F00\u4F1A\u8BDD\u300C${title}\u300D\u540E\u9875\u9762\u6CA1\u6709\u8DF3\u8F6C\uFF08\u5F53\u524D ${this.page.url()}\uFF09` };
      }
      return { ok: true, sessionId: landed };
    }
    const locator = this.page.locator(WEB_CHAT_LINK_SELECTOR).filter({ hasText: title }).first();
    const matches = await locator.count().catch(() => 0);
    if (matches === 0) return { ok: false, error: `\u672A\u5728\u7F51\u9875\u7AEF\u627E\u5230\u4F1A\u8BDD\u300C${title}\u300D` };
    const href = await locator.getAttribute("href").catch(() => null);
    const target = href === null ? void 0 : new URL(href, this.page.url()).toString();
    if (target === void 0) return { ok: false, error: `\u4F1A\u8BDD\u300C${title}\u300D\u7684\u94FE\u63A5\u4E0D\u53EF\u8BFB` };
    if (!this.page.url().startsWith(target)) {
      await locator.click({ timeout: 5e3 }).catch(() => void 0);
      await this.page.waitForFunction((url) => location.href.startsWith(url), target, { timeout: 5e3 }).catch(() => void 0);
    }
    if (!this.page.url().startsWith(target)) {
      await locator.scrollIntoViewIfNeeded().catch(() => void 0);
      await locator.click({ timeout: 5e3, force: true }).catch(() => void 0);
      await this.page.waitForFunction((url) => location.href.startsWith(url), target, { timeout: 5e3 }).catch(() => void 0);
    }
    if (!this.page.url().startsWith(target)) {
      await this.page.goto(target, { waitUntil: "domcontentloaded", timeout: 2e4 }).catch(() => void 0);
    }
    await this.waitForTranscriptPaint();
    if (!this.page.url().startsWith(target)) {
      return { ok: false, error: `\u70B9\u51FB\u4F1A\u8BDD\u300C${title}\u300D\u540E\u9875\u9762\u6CA1\u6709\u8DF3\u8F6C\uFF08\u5F53\u524D ${this.page.url()}\uFF09` };
    }
    return { ok: true, ...conversationIn() === void 0 ? {} : { sessionId: conversationIn() } };
  }
  /**
   * Wait for the transcript to actually be painted. The URL alone is not
   * proof: the SPA swaps the route first and the transcript after, and in that
   * window the DOM still holds the previous conversation. Empty is only a
   * legitimate answer after the wait.
   */
  async waitForTranscriptPaint(timeoutMs = 8e3) {
    if (!this.isPageAlive()) return;
    await this.page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length > 0,
      WEB_MESSAGE_ITEM_SELECTOR,
      { timeout: timeoutMs }
    ).catch(() => void 0);
  }
  /**
   * Arm the stream capture for a new turn: the next `/chat/completion` request
   * becomes the only one this turn can read.
   *
   * Why a generation rather than just clearing the buffer (which is what this
   * used to do): clearing is a WRITE aimed at the old owner, and an abandoned
   * turn's request is still in flight. It keeps appending into whatever object
   * sits at `window.__wcStream` — so the fresh buffer filled up with the
   * PREVIOUS turn's bytes — and, worse, its `loadend` set `done`, which ended
   * the new turn's reply loop on the first tick and committed whatever fragment
   * happened to be in the buffer as the complete answer. Bumping the generation
   * revokes the old request's right to write at all.
   *
   * The cursor is rewound with the buffer, or the first read of the new turn
   * would come back empty.
   *
   * A page still running an older engine bundle reports no
   * `__wcGenSupported`; there the buffer is only cleared, which is the old
   * best-effort behaviour (and unavoidable until the app restarts onto this
   * build). The clear happens either way so that "the buffer is empty at
   * submit" never depends on which script the page is running.
   */
  async resetCapture() {
    if (this.page === void 0) return;
    await this.page.evaluate((generation) => {
      const w = window;
      if (w.__wcGenSupported === generation) w.__wcGen = (w.__wcGen ?? 0) + 1;
      w.__wcStream = { text: "", done: false, started: false, status: 0, error: "" };
      w.__wcActiveReq = void 0;
      w.__wcReqLen = 0;
      w.__wcCursor = 0;
    }, CAPTURE_GENERATION).catch(() => void 0);
  }
  /**
   * Wait for evidence that a turn has actually begun, up to `timeoutMs`.
   *
   * Three independent signals, any one sufficient:
   *
   *   - the teed stream capture has started (or already produced bytes), which
   *     is the page's own request going out — the strongest possible evidence,
   *     and after {@link resetCapture} it can only be THIS turn's request;
   *   - the stop affordance is on screen, which is what the page shows while
   *     generating;
   *   - the message list grew a row that was not there before Enter — the
   *     page's own copy of the user message, which is slower to appear than
   *     either of the above but survives a page whose streaming UI has not
   *     caught up yet.
   *
   * @param timeoutMs - wall-clock budget for the wait.
   * @param baselineKeys - message-list keys captured before Enter; an empty
   *   baseline (the selector matched nothing) skips the third check, because
   *   "we cannot tell" must not be read as "nothing was submitted".
   * @returns true when a turn is under way, false when the budget ran out.
   */
  async waitForTurnStart(timeoutMs, baselineKeys = []) {
    if (this.page === void 0) return false;
    const deadline = Date.now() + timeoutMs;
    for (; ; ) {
      const captureStarted = await this.page.evaluate(() => {
        const w = window;
        const stream = w.__wcStream;
        if (stream === void 0) return false;
        return stream.started === true || stream.done === true || (stream.text ?? "") !== "";
      }).catch(() => false);
      if (captureStarted) return true;
      if (await this.isGenerating()) return true;
      if (baselineKeys.length > 0) {
        const keys = await this.messageKeys();
        if (keys.some((key) => !baselineKeys.includes(key))) return true;
      }
      if (Date.now() >= deadline) return false;
      await this.page.waitForTimeout(SUBMIT_VERIFY_POLL_MS);
    }
  }
  /** Detect whether the page is currently generating (stop affordance visible). */
  async isGenerating() {
    if (this.page === void 0) return false;
    try {
      for (const selector of WEB_STOP_SELECTORS) {
        if (await this.page.locator(selector).count().catch(() => 0) > 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * Click the stop-generation affordance, best effort.
   *
   * Queued, so a click from the panel waits behind whatever the engine is doing
   * to the page.
   */
  async stop() {
    await this.queue.run(() => this.stopInner());
  }
  /**
   * The unqueued body of {@link stop}.
   *
   * Callers that are ALREADY inside the serial queue must use this one:
   * `SerialQueue.run` appends to a promise chain, so awaiting the queued `stop`
   * from inside a queued task would wait for that task to finish — a deadlock
   * with no error and no timeout. `sendImpl` (failed submit) is such a caller.
   */
  async stopInner() {
    if (this.page === void 0) return;
    for (const selector of WEB_STOP_SELECTORS) {
      const locator = this.page.locator(selector).first();
      if (await locator.count().catch(() => 0) > 0) {
        await locator.click({ timeout: 5e3 }).catch(() => void 0);
        return;
      }
    }
  }
  /** Find the composer textarea (defensive selector list). */
  async composerLocator() {
    const selectors = [
      "#chat-input",
      'textarea[placeholder*="\u7ED9 DeepSeek"]',
      'textarea[placeholder*="\u53D1\u9001\u6D88\u606F"]',
      'textarea[placeholder*="Send a message"]',
      "textarea"
    ];
    for (const selector of selectors) {
      const locator = this.page.locator(selector).first();
      if (await locator.count().catch(() => 0) > 0) return locator;
    }
    return this.page.locator("textarea").first();
  }
  /**
   * Upload local files into the composer through the page's (usually hidden)
   * file input. `setInputFiles` fires the input's change event, which is how
   * DeepSeek picks up attachments without clicking its native dialog.
   *
   * Images only used to be attachable because the FIRST selector here tested
   * `accept*="image"` and the caller filtered the drop to image types. The page
   * takes documents too (its own picker allows a wide set), so the selector now
   * prefers an input that accepts more than images and falls back to any file
   * input at all — the page is the authority, and it answers with a visible
   * rejection if it will not take a given type.
   */
  async attachFiles(paths) {
    if (this.page === void 0) return { ok: false, error: "\u6D4F\u89C8\u5668\u672A\u542F\u52A8" };
    if (paths.length === 0) return { ok: true };
    const selectors = [
      'input[type="file"][accept*="."]',
      'input[type="file"][accept*="pdf" i]',
      'input[type="file"][accept*="image" i]',
      'input[type="file"]'
    ];
    for (const selector of selectors) {
      const input = this.page.locator(selector).last();
      if (await input.count().catch(() => 0) === 0) continue;
      try {
        await input.setInputFiles(paths);
        await this.page.waitForTimeout(1500);
        return { ok: true };
      } catch (error) {
        const detail = String(error);
        return {
          ok: false,
          error: /accept|not.*support|file type|unsupported/i.test(detail) ? `\u7F51\u9875\u7AEF\u4E0D\u63A5\u53D7\u8FD9\u4E2A\u6587\u4EF6\u7C7B\u578B\uFF1A${detail}` : `\u6587\u4EF6\u4E0A\u4F20\u5931\u8D25\uFF1A${detail}`
        };
      }
    }
    return { ok: false, error: "\u672A\u627E\u5230\u6587\u4EF6\u4E0A\u4F20\u5165\u53E3\uFF08\u9875\u9762\u53EF\u80FD\u5DF2\u6539\u7248\u6216\u5F53\u524D\u4F1A\u8BDD\u4E0D\u652F\u6301\u9644\u4EF6\uFF09" };
  }
  /**
   * Send a message through the real web page.
   * @param text - message text.
   * @param wait - when true (agent tools), resolve with the final reply after
   *   streaming completes; when false (GUI), resolve right after the message
   *   is submitted — the reply streams in the background into the transcript
   *   and the panel polls it live.
   */
  send(text2, wait = false, images) {
    return this.queue.run(() => this.sendImpl(text2, wait, images));
  }
  async sendImpl(text2, wait, images) {
    this.setLastError(void 0);
    let stored = false;
    if (this.busy) {
      const message = "\u4E0A\u4E00\u6761\u56DE\u590D\u8FD8\u5728\u751F\u6210\u4E2D\uFF0C\u8BF7\u7B49\u5B83\u7ED3\u675F\u6216\u70B9\u300C\u505C\u6B62\u300D\u540E\u518D\u53D1\u9001\u3002";
      this.setLastError(message, "BUSY");
      return { ok: false, error: message, code: "BUSY" };
    }
    if (this.newChatError !== void 0) {
      const detail = this.newChatError;
      this.newChatError = void 0;
      const message = `\u65B0\u5EFA\u5BF9\u8BDD\u6CA1\u6709\u5B8C\u6210\uFF08${detail}\uFF09\uFF0C\u4E3A\u907F\u514D\u628A\u6D88\u606F\u53D1\u8FDB\u4E0A\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u672C\u6B21\u53D1\u9001\u5DF2\u53D6\u6D88\u3002\u8BF7\u91CD\u65B0\u70B9\u51FB\u300C\u65B0\u5BF9\u8BDD\u300D\u540E\u518D\u8BD5\u3002`;
      this.setLastError(message, "PAGE_CHANGED");
      return { ok: false, error: message, code: "PAGE_CHANGED" };
    }
    if (!this.isPageAlive()) {
      try {
        await this.ensureBrowser();
      } catch (error) {
        const message = String(error);
        this.setLastError(message, "NETWORK");
        return { ok: false, error: message, code: "NETWORK" };
      }
    }
    const loggedIn = await this.isLoggedIn();
    if (loggedIn !== true) {
      const message = "\u5C1A\u672A\u767B\u5F55 DeepSeek \u7F51\u9875\u7AEF\u3002\u8BF7\u5728\u63D2\u4EF6\u9762\u677F\u70B9\u51FB\u300C\u6253\u5F00\u767B\u5F55\u7A97\u53E3\u300D\uFF0C\u5728\u5F39\u51FA\u7684\u6D4F\u89C8\u5668\u4E2D\u5B8C\u6210\u767B\u5F55\u540E\u91CD\u8BD5\u3002";
      this.setLastError(message, "NEED_LOGIN");
      return { ok: false, error: message, code: "NEED_LOGIN" };
    }
    try {
      const chat = this.store.ensureActiveChat(this.deepThink ? "deepseek-reasoner" : "deepseek-chat");
      const userMessage = {
        id: randomUUID(),
        role: "user",
        content: text2,
        ts: Date.now(),
        ...images !== void 0 && images.length > 0 ? { attachments: images } : {}
      };
      this.store.appendMessage(chat.id, userMessage);
      stored = true;
      if (chat.title === "\u65B0\u7684\u5BF9\u8BDD") {
        this.store.renameChat(chat.id, text2.replace(/\s+/g, " ").slice(0, 40));
      }
      const page = this.page;
      if (page === void 0) return { ok: false, error: "\u6D4F\u89C8\u5668\u672A\u542F\u52A8", ...stored ? { stored: true } : {} };
      await this.resetCapture();
      const composer = await this.composerLocator();
      await composer.waitFor({ state: "visible", timeout: 15e3 }).catch(() => void 0);
      await composer.click({ timeout: 5e3 }).catch(() => void 0);
      await composer.fill(text2, { timeout: 1e4 }).catch(async () => {
        await composer.type(text2, { delay: 5 });
      });
      if (images !== void 0 && images.length > 0) {
        const attach = await this.attachFiles(images);
        if (!attach.ok) {
          const message = attach.error ?? "\u6587\u4EF6\u4E0A\u4F20\u5931\u8D25";
          this.setLastError(message, "NETWORK");
          return { ok: false, error: message, code: "NETWORK", stored: true };
        }
      }
      const baselineKeys = await this.messageKeys();
      const previousReply = previousReplyMessage(this.store.getChat(chat.id)?.messages ?? []);
      await page.keyboard.press("Enter");
      const started = await this.waitForTurnStart(SUBMIT_VERIFY_MS, baselineKeys);
      if (!started) {
        await this.stopInner();
        const message = "\u7F51\u9875\u7AEF\u6CA1\u6709\u5F00\u59CB\u751F\u6210\u56DE\u590D\uFF1A\u6D88\u606F\u6CA1\u6709\u9001\u51FA\u53BB\uFF08\u8F93\u5165\u6846\u53EF\u80FD\u672A\u5C31\u7EEA\u6216\u88AB\u7981\u7528\uFF09\u3002\u8BF7\u91CD\u8BD5\uFF0C\u6216\u5728\u7F51\u9875\u7A97\u53E3\u91CC\u624B\u52A8\u786E\u8BA4\u540E\u518D\u53D1\u9001\u3002";
        this.setLastError(message, "PAGE_CHANGED");
        return { ok: false, error: message, code: "PAGE_CHANGED", stored: true };
      }
      const assistantId = randomUUID();
      if (!wait) {
        void this.streamReply(chat.id, assistantId, baselineKeys, previousReply);
        return { ok: true, chatId: chat.id, stored };
      }
      const result = await this.streamReply(chat.id, assistantId, baselineKeys, previousReply);
      return { ...result, stored };
    } catch (error) {
      const message = `\u53D1\u9001\u5931\u8D25\uFF1A${String(error)}`;
      this.setLastError(message);
      return { ok: false, error: message, ...stored ? { stored: true } : {} };
    }
  }
  /**
   * Background reply loop. Primary source is the teed SSE stream (raw model
   * markdown, no selectors); if the capture never installs, falls back to
   * scraping the rendered DOM. Writes the growing reply into the transcript
   * until the stream reports done/FINISHED or the timeout hits.
   *
   * @param baselineKeys - the message-list keys mounted BEFORE this turn was
   *   submitted (see `messageKeys`). The DOM fallback uses them to tell this
   *   turn's reply from the previous turn's, which is otherwise what a scrape
   *   taken too early returns.
   * @param previousReply - the previous answer's body as it stood before Enter
   *   (see {@link previousReplyMessage}). The DOM fallback refuses any snapshot
   *   that merely repeats it — the second, content-based half of the same
   *   "is this really a new reply?" question the keys answer structurally.
   */
  async streamReply(chatId, assistantId, baselineKeys = [], previousReply = "") {
    if (this.page === void 0) return { ok: false, error: "\u6D4F\u89C8\u5668\u672A\u542F\u52A8" };
    this.busy = true;
    this.busySince = Date.now();
    const started = Date.now();
    const timeout = this.config.replyTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    let replyMarkdown = "";
    let replySources;
    let replyError;
    let replyCode;
    let domChangedAt = 0;
    let lastDom = "";
    let staleDomSeen = false;
    let thinkingStartedAt = 0;
    let thinkingMs;
    const readCapture = async () => {
      if (this.page === void 0) return null;
      return this.page.evaluate(() => {
        const w = window;
        const stream = w.__wcStream;
        if (stream === void 0) return null;
        const cursor = w.__wcCursor ?? 0;
        const delta = cursor < stream.text.length ? stream.text.slice(cursor) : "";
        w.__wcCursor = stream.text.length;
        return { delta, done: stream.done, started: stream.started, status: stream.status, error: stream.error };
      }).catch(() => null);
    };
    const domSnapshot = async () => {
      const scraped = await this.scrapeConversation();
      const assistant = [...scraped].reverse().find((message) => message.role === "assistant");
      if (assistant === void 0) return { markdown: "" };
      const think = stripSearchTrace(assistant.parts.filter((part) => part.kind === "think").map((part) => part.text).join("\n\n")).trim();
      const bodyPart = assistant.parts.find((part) => part.kind === "body");
      const bodyMarkdown = bodyPart === void 0 ? "" : bodyPart.markdown === "" ? bodyPart.text : serializeToMarkdown(parseMarkup(bodyPart.markdown));
      const bodyMd = stripSearchTrace(bodyMarkdown);
      const thinkMd = think === "" ? "" : `<details><summary>\u601D\u8003\u8FC7\u7A0B</summary>

${think}

</details>`;
      return { markdown: [thinkMd, bodyMd].filter(Boolean).join("\n\n") };
    };
    const noteThinking = (markdown) => {
      const hasAnswer = hasAnswerBody(markdown);
      if (thinkingStartedAt === 0) {
        if (!markdown.trimStart().startsWith("<details>") || hasAnswer) return;
        thinkingStartedAt = Date.now();
        return;
      }
      if (thinkingMs === void 0 && hasAnswer) thinkingMs = Date.now() - thinkingStartedAt;
    };
    try {
      await this.page.waitForTimeout(700);
      let captureSeen = false;
      let captureCompleted = false;
      const parser = createStreamReplyParser();
      while (Date.now() - started < timeout) {
        const capture = await readCapture();
        if (capture !== null && capture.started) {
          captureSeen = true;
          if (capture.delta !== "") parser.push(capture.delta);
          if (capture.done) parser.finish();
          const parsed = parser.snapshot();
          if (parsed.markdown !== "") {
            noteThinking(parsed.markdown);
            replyMarkdown = parsed.markdown;
            replySources = sourcesOf(parsed.sources);
            this.store.upsertMessage(chatId, {
              id: assistantId,
              role: "assistant",
              content: replyMarkdown,
              ts: Date.now(),
              streaming: !(capture.done || parsed.finished),
              ...thinkingMs === void 0 ? {} : { thinkingMs },
              // The citation table rides the message, not the panel: it is the
              // only copy of the URLs, and the answer's numbers are meaningless
              // without it (and unrecoverable after a reload).
              ...replySources === void 0 ? {} : { sources: replySources }
            });
          }
          if (capture.done || parsed.finished) {
            captureCompleted = true;
            break;
          }
          if (capture.error !== "") {
            replyError = capture.error;
            replyCode = "NETWORK";
            break;
          }
        } else {
          const keys = await this.messageKeys();
          const fresh = baselineKeys.length === 0 || keys.some((key) => !baselineKeys.includes(key));
          if (fresh) {
            const dom = await domSnapshot();
            const replica = dom.markdown !== "" && repeatsPreviousReply(dom.markdown, previousReply);
            if (replica) staleDomSeen = true;
            if (dom.markdown !== "" && !replica) {
              noteThinking(dom.markdown);
              if (dom.markdown !== lastDom) {
                lastDom = dom.markdown;
                domChangedAt = Date.now();
                replyMarkdown = dom.markdown;
              }
              this.store.upsertMessage(chatId, {
                id: assistantId,
                role: "assistant",
                content: replyMarkdown,
                ts: Date.now(),
                streaming: true,
                ...thinkingMs === void 0 ? {} : { thinkingMs }
              });
            }
            if (replyMarkdown !== "" && Date.now() - domChangedAt >= DOM_STABLE_MS) break;
          }
        }
        await this.page.waitForTimeout(STREAM_TICK_MS);
      }
      if (replyMarkdown === "" && replyCode === void 0) {
        if (captureSeen && captureCompleted) {
          replyError = "\u9875\u9762\u534F\u8BAE\u7591\u4F3C\u6539\u7248\uFF1A\u5DF2\u6355\u83B7\u5230\u56DE\u590D\u6D41\u4F46\u65E0\u6CD5\u89E3\u6790\u51FA\u5185\u5BB9\uFF0C\u8BF7\u5347\u7EA7 dsh-dschat \u63D2\u4EF6";
          replyCode = "PAGE_CHANGED";
        } else if (staleDomSeen) {
          replyError = "\u7F51\u9875\u7AEF\u6CA1\u6709\u56DE\u590D\u8FD9\u6B21\u63D0\u95EE\uFF08\u9875\u9762\u4E0A\u4ECD\u7136\u662F\u4E0A\u4E00\u6761\u56DE\u590D\uFF09\u3002\u8BF7\u786E\u8BA4\u6D88\u606F\u662F\u5426\u5DF2\u9001\u51FA\uFF0C\u6216\u91CD\u65B0\u53D1\u9001\u3002";
          replyCode = "TIMEOUT";
        } else {
          replyError = "\u7B49\u5F85\u56DE\u590D\u8D85\u65F6\uFF08\u672A\u6355\u83B7\u5230\u7F51\u9875\u56DE\u590D\u6D41\uFF1B\u53EF\u80FD\u672A\u767B\u5F55\u6216\u9875\u9762\u7ED3\u6784\u5DF2\u53D8\u5316\uFF09";
          replyCode = "TIMEOUT";
        }
      } else if (replyCode === void 0 && Date.now() - started >= timeout) {
        replyError = "\u751F\u6210\u8D85\u65F6\uFF0C\u5DF2\u8FD4\u56DE\u90E8\u5206\u5185\u5BB9";
        replyCode = "TIMEOUT";
      }
      if (replyMarkdown !== "") {
        this.store.upsertMessage(chatId, {
          id: assistantId,
          role: "assistant",
          content: replyMarkdown,
          ts: Date.now(),
          streaming: false,
          error: replyError,
          ...thinkingMs === void 0 ? {} : { thinkingMs },
          ...replySources === void 0 ? {} : { sources: replySources }
        });
      }
      this.store.setStreaming(chatId, false);
      this.store.flush();
      if (replyError !== void 0) this.setLastError(replyError, replyCode);
      return { ok: replyError === void 0, chatId, reply: replyMarkdown, error: replyError, code: replyCode };
    } catch (error) {
      const message = `\u751F\u6210\u8FC7\u7A0B\u4E2D\u65AD\uFF1A${String(error)}`;
      this.setLastError(message);
      if (replyMarkdown !== "") {
        this.store.upsertMessage(chatId, {
          id: assistantId,
          role: "assistant",
          content: replyMarkdown,
          ts: Date.now(),
          streaming: false,
          error: message,
          ...thinkingMs === void 0 ? {} : { thinkingMs },
          ...replySources === void 0 ? {} : { sources: replySources }
        });
      }
      this.store.setStreaming(chatId, false);
      this.store.flush();
      return { ok: false, chatId, reply: replyMarkdown, error: message };
    } finally {
      this.busy = false;
      this.busySince = void 0;
    }
  }
  /**
   * Start a new chat: a fresh local transcript, plus best-effort work on the web
   * page to leave the previous conversation.
   *
   * The local transcript is created and returned IMMEDIATELY, so the panel
   * switches to the empty conversation on click instead of after the browser
   * work. That is safe because `send` rides the same serial queue: a message
   * typed during the handover queues BEHIND this task, so it can never land in
   * the conversation the user just left.
   */
  async newChat() {
    if (this.busy) return { ok: false, error: "\u6B63\u5728\u751F\u6210\u56DE\u590D\uFF0C\u8BF7\u5148\u505C\u6B62\u6216\u7B49\u5F85\u5B8C\u6210" };
    const chat = this.store.createChat(this.deepThink ? "deepseek-reasoner" : "deepseek-chat");
    this.newChatPending = true;
    this.newChatError = void 0;
    void this.queue.run(async () => {
      try {
        await this.ensureBrowser();
        if (this.page !== void 0) {
          let clicked = false;
          for (const selector of WEB_NEW_CHAT_SELECTORS) {
            const locator = this.page.locator(selector).first();
            if (await locator.count().catch(() => 0) > 0) {
              await locator.click({ timeout: 5e3 }).catch(() => void 0);
              clicked = true;
              break;
            }
          }
          if (!clicked) {
            await this.openDeepSeekPage();
          }
          await this.waitForEmptyConversation();
        }
      } catch (error) {
        if (isShutdownError(error)) {
          await this.disposeBrowser().catch(() => void 0);
          this.newChatError = void 0;
        } else {
          this.newChatError = String(error);
        }
      } finally {
        this.newChatPending = false;
      }
    });
    return { ok: true, chatId: chat.id };
  }
  /**
   * Wait until the page really shows an empty conversation.
   *
   * A fixed sleep was both slower than needed and unreliable: it could return
   * while the previous conversation was still painted, so the first message of a
   * "new" chat could be appended to the old one. The virtualizer's item key is
   * the structural signal that the transcript is empty.
   */
  async waitForEmptyConversation() {
    if (this.page === void 0) return;
    await this.page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 0,
      WEB_MESSAGE_ITEM_SELECTOR,
      { timeout: 8e3 }
    ).catch(() => void 0);
  }
  /**
   * Click a toggle on the page by label candidates (best effort — the DeepSeek
   * web UI has no stable contract, so a miss is not an error). The toggles are
   * `div.ds-toggle-button` elements (not `<button>`), so those selectors come
   * first; `<button>` variants remain as fallbacks for older page versions.
   * @returns true when a candidate was clicked.
   */
  async clickToggle(labels) {
    if (!this.isPageAlive()) return false;
    const selectors = [];
    for (const label of labels) {
      selectors.push(
        `div.ds-toggle-button:has-text("${label}")`,
        `[aria-pressed]:has-text("${label}")`,
        `button:has-text("${label}")`,
        `[aria-label*="${label}"]`
      );
    }
    for (const selector of selectors) {
      const locator = this.page.locator(selector).first();
      if (await locator.count().catch(() => 0) > 0) {
        await locator.click({ timeout: 5e3 }).catch(() => void 0);
        return true;
      }
    }
    return false;
  }
  /** Toggle deep-think (R1) mode on the web page. */
  async setDeepThink(enabled) {
    if (this.busy) return { ok: false, error: "\u6B63\u5728\u751F\u6210\u56DE\u590D\uFF0C\u8BF7\u5148\u7B49\u5F85\u5B8C\u6210" };
    return this.queue.run(async () => {
      try {
        await this.ensureBrowser();
        const current = await this.readToggles();
        if (current.deepThink !== enabled) {
          await this.clickToggle(["\u6DF1\u5EA6\u601D\u8003", "DeepThink", "Deep Think"]);
        }
        this.deepThink = enabled;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
  }
  /** Toggle internet search on the web page (web label: 智能搜索). */
  async setSearch(enabled) {
    if (this.busy) return { ok: false, error: "\u6B63\u5728\u751F\u6210\u56DE\u590D\uFF0C\u8BF7\u5148\u7B49\u5F85\u5B8C\u6210" };
    return this.queue.run(async () => {
      try {
        await this.ensureBrowser();
        const current = await this.readToggles();
        if (current.search !== enabled) {
          await this.clickToggle(["\u667A\u80FD\u641C\u7D22", "\u8054\u7F51\u641C\u7D22", "Search"]);
        }
        this.search = enabled;
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
  }
  /** Close the browser (releases the profile lock). */
  async disposeBrowser() {
    try {
      await this.context?.close();
    } catch {
    }
    this.context = void 0;
    this.page = void 0;
    this.loginMode = false;
    if (this.state !== "error") this.setState("stopped");
  }
  /**
   * Diagnostics for the scrapers. A failed recover used to report only
   * "读取网页会话历史失败（页面可能已改版）", which is unfalsifiable — it does not
   * say whether the list was empty, the selector missed, or the page was still
   * loading. This reports what the page actually contains, using the SAME
   * exported selectors the scrapers use, so a report can be acted on.
   */
  async probePage() {
    if (!this.isPageAlive()) {
      return { pageAlive: false, note: "\u6D4F\u89C8\u5668\u672A\u542F\u52A8\uFF1B\u5148\u53D1\u8D77\u4E00\u6B21\u64CD\u4F5C\u518D\u63A2\u6D4B" };
    }
    return await this.page.evaluate(async (selectors) => {
      const count = (selector) => {
        try {
          return document.querySelectorAll(selector).length;
        } catch {
          return -1;
        }
      };
      const items = Array.from(document.querySelectorAll(selectors.messageItem));
      const sample = items.slice(0, 4).map((item) => {
        const text2 = (item.textContent ?? "").trim().replace(/\s+/g, " ");
        return {
          key: item.getAttribute("data-virtual-list-item-key"),
          hasAssistantBody: item.querySelector(".ds-assistant-message-main-content") !== null,
          hasMarkdown: item.querySelector(".ds-markdown") !== null,
          roleAttr: item.getAttribute("data-role") ?? item.getAttribute("class")?.slice(0, 60) ?? null,
          textHead: text2.slice(0, 60),
          textLength: text2.length
        };
      });
      let hasToken = false;
      try {
        hasToken = (JSON.parse(localStorage.getItem("userToken") ?? "{}")?.value ?? "") !== "";
      } catch {
      }
      let historyCachePresent = false;
      try {
        const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
        historyCachePresent = databases.some((database) => database.name === "deepseek-chat");
      } catch {
      }
      return {
        pageAlive: true,
        url: location.href,
        sessionId: /\/a\/chat\/s\/([^/?#]+)/.exec(location.href)?.[1] ?? null,
        readyState: document.readyState,
        linkCount: count(selectors.chatLink),
        messageItemCount: items.length,
        messageItemSample: sample,
        assistantContentCount: count(".ds-assistant-message-main-content"),
        markdownCount: count(".ds-markdown"),
        thinkCount: count(".ds-think-content"),
        textareaCount: count("textarea"),
        hasUserToken: hasToken,
        historyCachePresent,
        bodyLength: document.body?.innerText?.length ?? 0,
        bodyHead: (document.body?.innerText ?? "").slice(0, 200)
      };
    }, {
      chatLink: WEB_CHAT_LINK_SELECTOR,
      messageItem: WEB_MESSAGE_ITEM_SELECTOR
    });
  }
  /** Engine snapshot for status routes and agent tools. */
  async status() {
    if (this.state === "ready" && !this.isPageAlive()) {
      if (!this.relaunchPending) {
        this.relaunchPending = true;
        void this.ensureBrowser().catch(() => void 0).finally(() => {
          this.relaunchPending = false;
        });
      }
    } else if (this.engineError !== void 0 && !this.isPageAlive()) {
      this.setState("stopped");
    }
    let loggedIn = await this.isLoggedIn();
    if (loggedIn === true) this.loggedInOnce = true;
    else if (loggedIn === false) this.loggedInOnce = false;
    else if (loggedIn === null && this.loggedInOnce) loggedIn = true;
    const toggles = await this.readToggles();
    this.deepThink = toggles.deepThink;
    this.search = toggles.search;
    return {
      // A background self-heal counts as 'launching': that is what the panel
      // should say while the browser is coming back, and `state` alone still
      // reads 'ready' for the tick or two before the launch flips it.
      engine: this.relaunchPending ? "launching" : this.state,
      engineError: this.engineError,
      loggedIn,
      pageUrl: this.pageUrl(),
      deepThink: this.deepThink,
      search: this.search,
      busy: this.busy,
      preparingNewChat: this.newChatPending,
      lastError: this.lastError,
      busySince: this.busySince,
      lastErrorCode: this.lastErrorCode
    };
  }
};
function parseMarkup(html) {
  return new MarkupParser(html).parse();
}
var MarkupParser = class {
  tokens;
  index = 0;
  constructor(html) {
    this.tokens = html.split(/(<[^>]+>)/).filter((token) => token !== "");
  }
  parse() {
    const root = this.parseChildren(void 0);
    return root;
  }
  parseChildren(parent) {
    const node = { nodeType: 1, children: [], attributes: {}, parent };
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (!token.startsWith("<")) {
        node.children.push({ nodeType: 3, textContent: token, children: [], attributes: {}, parent: node });
        this.index++;
        continue;
      }
      const close = /^<\/([a-zA-Z0-9]+)>$/.exec(token);
      if (close !== null) {
        this.index++;
        if (close[1].toLowerCase() === (node.tagName ?? "").toLowerCase()) return node;
        continue;
      }
      const open = /^<([a-zA-Z0-9]+)((?:\s+[a-zA-Z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*(\/?)>$/.exec(token);
      if (open === null) {
        this.index++;
        continue;
      }
      const [, rawTag, attrsRaw] = open;
      const tag = rawTag.toLowerCase();
      const attributes = {};
      if (attrsRaw !== void 0) {
        const attrRe = /([a-zA-Z0-9-]+)(?:=("[^"]*"|'[^']*'|[^\s>]*))?/g;
        let match;
        while ((match = attrRe.exec(attrsRaw)) !== null) {
          const value = match[2] === void 0 ? void 0 : match[2].replace(/^["']|["']$/g, "");
          attributes[match[1]] = value;
        }
      }
      this.index++;
      const element = { tagName: tag, nodeType: 1, children: [], attributes, parent };
      if (!open[3].endsWith("/")) {
        const child = this.parseChildren(element);
        for (const grandchild of child.children) element.children.push(grandchild);
      }
      node.children.push(element);
    }
    return node;
  }
};

// src/export-dir.ts
import { mkdirSync as mkdirSync2 } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join as join2 } from "node:path";
function home() {
  const value = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return value === "" ? homedir() : value;
}
function cleaned(value) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? void 0 : trimmed;
}
function resolveExportDir(configured) {
  const wanted = cleaned(configured) ?? cleaned(process.env.DSH_EXPORT_DIR);
  if (wanted === void 0) return ensureDir(join2(home(), "Downloads"));
  return ensureDir(isAbsolute(wanted) ? wanted : join2(home(), wanted));
}
function ensureDir(path) {
  mkdirSync2(path, { recursive: true });
  return path;
}

// src/routes.ts
import { mkdirSync as mkdirSync4, readFileSync, readdirSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { basename as basename2, extname, join as join4, resolve } from "node:path";
import { randomUUID as randomUUID3 } from "node:crypto";

// src/transfer.ts
import { mkdirSync as mkdirSync3, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, join as join3 } from "node:path";
import { randomUUID as randomUUID2, createHash } from "node:crypto";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId, SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
var ROLE_LABEL = { user: "\u7528\u6237", assistant: "DeepSeek\uFF08\u7F51\u9875\u7AEF\uFF09" };
function stripThinking(markdown) {
  return markdown.replace(/<details>\s*<summary>.*?<\/summary>[\s\S]*?<\/details>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function sourceFootnote(sources) {
  if (sources === void 0 || sources.length === 0) return [];
  const entries = sources.map((source, index) => ({ source, number: index + 1 })).filter((entry) => (entry.source?.url ?? "") !== "").map(({ source, number }) => {
    const title = source.title?.trim();
    return `[${number}] [${title !== void 0 && title !== "" ? title : source.url}](${source.url})`;
  });
  if (entries.length === 0) return [];
  return ["", `> \u53C2\u8003\u6765\u6E90\uFF1A${entries.join(" \xB7 ")}`];
}
function renderMessagesMarkdown(messages, options) {
  const excludeThinking = options?.excludeThinking ?? false;
  const lines = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.streaming) continue;
    const content = (excludeThinking ? stripThinking(message.content) : message.content).trim();
    lines.push(`## ${ROLE_LABEL[message.role]}`);
    lines.push("");
    lines.push(content === "" ? "\uFF08\u65E0\u5185\u5BB9\uFF09" : content);
    if (message.attachments !== void 0 && message.attachments.length > 0) {
      lines.push("");
      lines.push(`> \u{1F4CE} \u56FE\u7247\u9644\u4EF6\uFF1A${message.attachments.join("\u3001")}`);
    }
    lines.push(...sourceFootnote(message.sources));
    if (message.error !== void 0) {
      lines.push("");
      lines.push(`> \u26A0\uFE0F \u8BE5\u6761\u56DE\u590D\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF1A${message.error}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
function renderTranscriptMarkdown(transcript, options) {
  const lines = [];
  lines.push(`# \u7F51\u9875\u7AEF\u5BF9\u8BDD\u8BB0\u5F55\uFF1A${transcript.title}`);
  lines.push("");
  lines.push(`- \u6765\u6E90\uFF1ADeepSeek \u7F51\u9875\u7AEF\uFF08chat.deepseek.com\uFF09\xB7 \u6A21\u578B ${transcript.model}`);
  lines.push(`- \u5F00\u59CB\u65F6\u95F4\uFF1A${new Date(transcript.createdAt).toLocaleString()}`);
  lines.push(`- \u6D88\u606F\u6570\uFF1A${transcript.messages.length}`);
  lines.push("");
  lines.push("> \u4EE5\u4E0B\u5185\u5BB9\u7531 dsh-dschat \u63D2\u4EF6\u4ECE DeepSeek \u7F51\u9875\u7AEF\u4F1A\u8BDD\u5BFC\u51FA\u3002");
  lines.push("");
  const body = renderMessagesMarkdown(transcript.messages, options);
  if (body !== "") lines.push(body);
  return lines.join("\n").trim() + "\n";
}
var HANDOFF_PREAMBLE = "\u8FD9\u662F\u4E00\u6B21\u4ECE DeepSeek \u7F51\u9875\u7AEF\u4F1A\u8BDD\uFF08chat.deepseek.com\uFF09\u8F6C\u6765\u7684\u4E0A\u4E0B\u6587\u4EA4\u63A5\u3002\u4E0B\u9762\u7684\u4EFB\u52A1\u7B80\u62A5\u5DF2\u628A\u8BE5\u5BF9\u8BDD\u63D0\u70BC\u4E3A\u53EF\u6267\u884C\u7684\u4EFB\u52A1\u4E0A\u4E0B\u6587\u2014\u2014\u628A\u5B83\u5F53\u4F5C\u65E2\u5B9A\u76EE\u6807\u4E0E\u80CC\u666F\uFF0C\u76F4\u63A5\u5728\u5176\u57FA\u7840\u4E0A\u7EE7\u7EED\uFF0C\u4E0D\u8981\u590D\u8FF0\u3002";
var DISTILL_INSTRUCTION = [
  "You are distilling a web-chat conversation (a user exploring and planning with a DeepSeek web model) into an executable task brief for a coding agent that will resume this work in a FRESH session WITHOUT the raw conversation.",
  "",
  'Output EXACTLY the Markdown structure below \u2014 every section, in order, terse bullets, "(none)" for an empty section:',
  "",
  "## Objective",
  "- [the concrete goal/task to execute; quote the user's exact wording where it matters]",
  "",
  "## Established Context",
  "- [decisions, constraints, requirements, and facts already settled]",
  "",
  "## Current State",
  "- [what has been designed, decided, or produced so far]",
  "",
  "## Next Steps",
  "- [concrete ordered actions the coding agent should take]",
  "",
  "## Open Questions & Risks",
  "- [anything unresolved, uncertain, or risky]",
  "",
  "Rules:",
  "- Terse, concrete engineering prose. Preserve exact identifiers, paths, commands, error strings, code snippets, and numeric values.",
  "- Do not invent facts; mark uncertainty explicitly.",
  "- Do not mention this distillation request or the web-chat source.",
  "- Output only the brief."
].join("\n");
function persistenceOf(ctx, required = true) {
  const service = ctx.get("sessionPersistence");
  if (service === void 0 && required) {
    throw new Error("\u672A\u627E\u5230\u4F1A\u8BDD\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u65E0\u6CD5\u5EF6\u7EED\u5DF2\u6709\u4F1A\u8BDD");
  }
  return service;
}
var DEFAULT_TRANSFER_MAX_TOKENS = 4096;
var DEFAULT_TRANSFER_CHUNK_TOKENS = 1024;
var CHUNK_CHAR_BUDGET = 12e3;
async function resolveDistillTarget(llm, provider, model) {
  if (provider !== "" && model !== "") return { provider, model };
  const providers = llm.listProviders();
  if (providers.length === 0) return void 0;
  const baseProvider = provider !== "" ? provider : (providers.find((entry) => entry.id.toLowerCase().includes("deepseek")) ?? providers[0]).id;
  if (model !== "") return { provider: baseProvider, model };
  const models = await llm.listModels(baseProvider);
  const picked = models.find((entry) => entry.id.toLowerCase().includes("chat")) ?? models[0];
  return picked === void 0 ? void 0 : { provider: baseProvider, model: picked.id };
}
var MAX_DISTILL_CHUNKS = 20;
var OVERFLOW_FOLD_MESSAGES = 40;
function chunkTranscript(transcript, budget = CHUNK_CHAR_BUDGET) {
  const messages = transcript.messages.filter((message) => !(message.role === "assistant" && message.streaming));
  const chunks = [];
  let current = [];
  let size = 0;
  for (const message of messages) {
    const messageSize = Math.max(1, message.content.length);
    if (current.length > 0 && size + messageSize > budget && chunks.length < MAX_DISTILL_CHUNKS - 1) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(message);
    size += messageSize;
  }
  if (current.length > 0) {
    const overflow = chunks.length >= MAX_DISTILL_CHUNKS - 1 && current.length > OVERFLOW_FOLD_MESSAGES;
    chunks.push(overflow ? current.slice(-OVERFLOW_FOLD_MESSAGES) : current);
  }
  return chunks;
}
var CHUNK_SUMMARY_INSTRUCTION = [
  "You are condensing one slice of a long web-chat conversation (a user exploring and planning with a DeepSeek web model) into dense notes that a later synthesis step will merge into a task brief.",
  "",
  "Preserve exactly, and do not invent:",
  "- decisions, constraints, requirements, and settled facts",
  "- exact identifiers, paths, commands, error strings, code snippets, and numeric values",
  "- anything still open, uncertain, or risky",
  "",
  "Output compact markdown notes. Mark uncertainty explicitly. Do not mention this summarization request or the source. Output only the notes."
].join("\n");
async function runDistillCall(llm, target, instruction, maxTokens) {
  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream({
      provider: target.provider,
      model: target.model,
      messages: [createUserMessage({
        content: [{ type: "text", text: instruction }],
        // Same producer-owned source kind the session events carry: `plugin` is
        // retired and must not appear in a message this plugin authors.
        source: { kind: "user" }
      })],
      maxTokens,
      purpose: "compaction"
    })) {
      assembler.push(chunk);
    }
  } catch {
    return void 0;
  }
  const finish = assembler.finish;
  if (finish.kind !== "stop" && finish.kind !== "max-tokens") return void 0;
  const text2 = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
  return text2 === "" ? void 0 : text2;
}
async function distillTranscriptToBrief(ctx, transcript, config) {
  const llm = ctx.get("llm");
  if (llm === void 0) return void 0;
  const target = await resolveDistillTarget(llm, config.provider, config.model).catch(() => void 0);
  if (target === void 0) return void 0;
  const maxTokens = config.maxTokens !== void 0 && config.maxTokens > 0 ? config.maxTokens : DEFAULT_TRANSFER_MAX_TOKENS;
  const chunkTokens = config.chunkTokens !== void 0 && config.chunkTokens > 0 ? config.chunkTokens : DEFAULT_TRANSFER_CHUNK_TOKENS;
  const chunks = chunkTranscript(transcript);
  let source;
  if (chunks.length <= 1) {
    source = `${DISTILL_INSTRUCTION}

--- \u7F51\u9875\u5BF9\u8BDD\u8BB0\u5F55 ---

${renderTranscriptMarkdown(transcript, { excludeThinking: true })}`;
  } else {
    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkMarkdown = renderMessagesMarkdown(chunks[i], { excludeThinking: true });
      const summary = await runDistillCall(
        llm,
        target,
        `${CHUNK_SUMMARY_INSTRUCTION}

--- \u7247\u6BB5 ${i + 1} / ${chunks.length} ---

${chunkMarkdown}`,
        chunkTokens
      );
      summaries.push(summary ?? `\uFF08\u7247\u6BB5 ${i + 1} \u6458\u8981\u5931\u8D25\uFF0C\u622A\u53D6\u539F\u6587\uFF09
${chunkMarkdown.slice(0, CHUNK_CHAR_BUDGET)}`);
    }
    source = `${DISTILL_INSTRUCTION}

--- \u7F51\u9875\u5BF9\u8BDD\u7247\u6BB5\u6458\u8981\uFF08\u5171 ${chunks.length} \u6BB5${chunks.length >= MAX_DISTILL_CHUNKS ? `\uFF0C\u5BF9\u8BDD\u8FC7\u957F\u5DF2\u622A\u53D6\u672B\u5C3E ${OVERFLOW_FOLD_MESSAGES} \u6761\u6D88\u606F` : ""}\uFF0C\u5DF2\u6309\u6BB5\u6458\u8981\uFF09 ---

${summaries.join("\n\n---\n\n")}`;
  }
  const brief = await runDistillCall(llm, target, source, maxTokens);
  if (brief === void 0) return void 0;
  return { brief, provider: target.provider, model: target.model };
}
function transcriptUserMessageEvent(markdown, seq) {
  return {
    type: "user/message",
    seq,
    time: Date.now(),
    // Surface events must declare how they entered the ordered surface; a
    // seeded user prompt appends to the tail.
    surfaceOp: "append",
    data: {
      id: randomUUID2(),
      role: "user",
      content: [{ type: "text", text: markdown }],
      // v4 RETIRES the `plugin` source kind: native admission rejects it with
      // "format v4 message requires a producer-owned source kind", and a plugin
      // source only survives at all as the rewritten `plugin:<name>` form. A
      // prompt this plugin *injects on the user's behalf* is a user message, so
      // it carries the `user` producer kind — the same one the title event uses.
      source: { kind: "user" }
    }
  };
}
function transcriptSeedEvent(markdown) {
  return transcriptUserMessageEvent(markdown, 0);
}
function normalizeSessionTitleText(text2) {
  const cleaned2 = text2.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(cleaned2).slice(0, 80).join("");
}
function transcriptTitleEvent(title, seq, time) {
  return {
    type: "session/title",
    seq,
    time,
    data: {
      title: normalizeSessionTitleText(title),
      messageSeqs: [],
      source: { kind: "user" }
    }
  };
}
function normalizeCwd(cwd) {
  const resolved = cwd === void 0 || cwd === "" ? process.cwd() : cwd;
  if (!resolved.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(resolved)) {
    throw new Error(`cwd \u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u6536\u5230: ${resolved}`);
  }
  return resolved;
}
function handoffProvenance(transcript, mode) {
  const fingerprint = createHash("sha1").update(`${transcript.id}|${transcript.messages.length}|${transcript.messages.at(-1)?.id ?? ""}|${mode}`).digest("hex").slice(0, 10);
  const name2 = transcript.title.trim() === "" ? transcript.id : transcript.title.trim();
  return `*\uFF08dsh-dschat \u8FC1\u79FB\uFF1A${name2} \xB7 ${transcript.id} \xB7 ${fingerprint}\uFF09*`;
}
function workspaceRegistryOf(ctx) {
  return ctx.get("workspaceRegistry");
}
function emitHostEvent(ctx, name2, ...args) {
  try {
    ctx.emit(name2, ...args);
  } catch {
  }
}
function announceStoredSession(ctx, header, updatedAt) {
  const row = {
    sessionId: header.id,
    // The seed user message is the session's first activity; createdAt is the
    // same instant, and using the event time keeps list ordering honest.
    updatedAt,
    running: false,
    // Cold by construction: this session has no live owner until the user opens
    // it, which is what lets the GUI resume rather than adopt it.
    agentAvailable: false,
    blank: false,
    ...header.cwd === void 0 ? {} : { cwd: header.cwd },
    ...header.parentSession === void 0 ? {} : { parentSessionId: header.parentSession },
    ...header.origin === void 0 ? {} : { origin: header.origin }
  };
  emitHostEvent(ctx, "api-session/added", row);
}
function announceStoredActivity(ctx, sessionId, updatedAt) {
  emitHostEvent(ctx, "api-session/activity", sessionId, updatedAt);
}
function appendRefusal(sessionId, error) {
  const name2 = error instanceof Error ? error.name : "";
  if (name2 === "SessionPersistenceNotFoundError") return new Error(`\u627E\u4E0D\u5230 harness \u4F1A\u8BDD ${sessionId}`);
  if (name2 === "SessionAlreadyOwnedError") {
    return new Error(`\u4F1A\u8BDD ${sessionId} \u6B63\u5728\u4F7F\u7528\u4E2D\uFF08\u5DF2\u5728 GUI \u6253\u5F00\u6216\u6B63\u5728\u8FD0\u884C\uFF09\uFF0C\u65E0\u6CD5\u5411\u5176\u65E5\u5FD7\u8FFD\u52A0\u6D88\u606F\uFF1B\u8BF7\u6539\u9009\u4E00\u4E2A\u672A\u6253\u5F00\u7684\u4F1A\u8BDD\uFF0C\u6216\u6539\u7528\u300C\u65B0\u5EFA\u4F1A\u8BDD\u300D`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
async function resolveTransferTarget(ctx, input) {
  const registry = workspaceRegistryOf(ctx);
  const target = input.workspace;
  if (target?.workspaceId !== void 0 && target.workspaceId !== "") {
    if (registry === void 0) {
      throw new Error(`\u65E0\u6CD5\u5F52\u5165\u5DE5\u4F5C\u533A ${target.workspaceId}\uFF1A\u5F53\u524D\u90E8\u7F72\u672A\u6302\u8F7D\u5DE5\u4F5C\u533A\u670D\u52A1`);
    }
    const workspace = registry.get(target.workspaceId);
    if (workspace === void 0) {
      throw new Error(`\u5DE5\u4F5C\u533A ${target.workspaceId} \u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664`);
    }
    return { cwd: workspace.path, workspace };
  }
  if (target?.path !== void 0 && target.path !== "") {
    let cwd;
    try {
      cwd = await realpath(target.path);
    } catch {
      throw new Error(`\u5DE5\u4F5C\u533A\u8DEF\u5F84\u4E0D\u53EF\u7528\uFF08\u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u76EE\u5F55\uFF09\uFF1A${target.path}`);
    }
    const workspace = registry === void 0 ? void 0 : await registry.resolveByPath(cwd).catch(() => void 0);
    return { cwd, workspace };
  }
  return { cwd: normalizeCwd(input.cwd) };
}
async function assertAppendable(ctx, sessionId) {
  const persistence = persistenceOf(ctx);
  const handle = await persistence.open(SessionId(sessionId), "write").catch((error) => {
    throw appendRefusal(sessionId, error);
  });
  await handle.close();
}
async function appendToExistingSession(ctx, sessionId, markdown, distilled) {
  const persistence = persistenceOf(ctx);
  const id = SessionId(sessionId);
  const handle = await persistence.open(id, "write").catch((error) => {
    throw appendRefusal(sessionId, error);
  });
  try {
    const result = await appendThroughHandle(handle, id, markdown, distilled);
    announceStoredActivity(ctx, id, Date.now());
    return result;
  } finally {
    await handle.close();
  }
}
async function appendThroughHandle(handle, id, markdown, distilled) {
  const inspection = await handle.read();
  const marker = provenanceOf(markdown);
  if (marker !== void 0 && sessionContainsProvenance(inspection.events, marker)) {
    return { sessionId: id, distilled, attached: false, duplicate: true };
  }
  let nextSeq = 0;
  let maxTurn = 0;
  for (const event of inspection.events) {
    if (event.seq >= nextSeq) nextSeq = event.seq + 1;
    const turn2 = event.data?.turn;
    if (typeof turn2 === "number" && turn2 > maxTurn) maxTurn = turn2;
  }
  const turn = maxTurn + 1;
  const now = Date.now();
  const appended = [
    { type: "turn/start", seq: nextSeq, time: now, data: { turn } },
    { type: "step/start", seq: nextSeq + 1, time: now, data: { turn, step: 1 } },
    transcriptUserMessageEvent(markdown, nextSeq + 2)
  ];
  await handle.append(appended);
  return { sessionId: id, distilled, attached: false };
}
function provenanceOf(markdown) {
  return /（dsh-dschat 迁移：[^）]*）/.exec(markdown)?.[0];
}
function sessionContainsProvenance(events, marker) {
  for (const event of events) {
    if (event.type !== "user/message") continue;
    const content = event.data?.content ?? [];
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.includes(marker)) return true;
    }
  }
  return false;
}
async function transferToHarnessSession(ctx, input, config, mode) {
  const rawMarkdown = renderTranscriptMarkdown(input.transcript, { excludeThinking: true });
  const continueId = input.targetSessionId !== void 0 && input.targetSessionId !== "" ? input.targetSessionId : void 0;
  let target;
  if (continueId === void 0) {
    target = await resolveTransferTarget(ctx, input);
  } else {
    await assertAppendable(ctx, continueId);
  }
  const shouldDistill = mode === "distill" ? true : mode === "raw" ? false : config.distill;
  let seedMarkdown = `${HANDOFF_PREAMBLE}

${rawMarkdown}`;
  let distilled = false;
  if (shouldDistill) {
    const result = await distillTranscriptToBrief(ctx, input.transcript, config);
    if (result !== void 0) {
      seedMarkdown = `${HANDOFF_PREAMBLE}

${result.brief}

> \uFF08\u5DF2\u7531 ${result.provider}/${result.model} \u4ECE\u7F51\u9875\u5BF9\u8BDD\u84B8\u998F\u751F\u6210\uFF09`;
      distilled = true;
    }
  }
  seedMarkdown = `${seedMarkdown}

${handoffProvenance(input.transcript, shouldDistill ? "distill" : "raw")}`;
  if (continueId !== void 0) {
    return appendToExistingSession(ctx, continueId, seedMarkdown, distilled);
  }
  if (target === void 0) throw new Error("\u8F6C\u79FB\u76EE\u6807\u672A\u89E3\u6790");
  const id = SessionId(`session-${randomUUID2()}`);
  const createdAt = Date.now();
  const header = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt,
    cwd: target.cwd,
    isSeeded: false,
    delegationDepth: 0
  };
  const seedEvent = transcriptSeedEvent(seedMarkdown);
  const title = normalizeSessionTitleText(input.transcript.title);
  const events = [seedEvent];
  if (title !== "") events.push(transcriptTitleEvent(title, seedEvent.seq + 1, seedEvent.time));
  const persistence = persistenceOf(ctx, false);
  const cold = persistence !== void 0;
  if (persistence !== void 0) {
    const handle = await persistence.create(header);
    try {
      await handle.append(events);
      await handle.flush();
    } finally {
      await handle.close();
    }
  } else {
    ctx.sessions.create(id, { meta: { cwd: target.cwd }, seed: events });
  }
  let attached = false;
  if (target.workspace !== void 0) {
    try {
      await target.workspace.attachSession(id);
      attached = true;
    } catch {
      attached = false;
    }
  }
  if (cold) announceStoredSession(ctx, header, seedEvent.time);
  const workspaceId = attached && target.workspace !== void 0 ? target.workspace.id : void 0;
  return { sessionId: id, distilled, attached, workspaceId };
}
function exportTranscriptFile(input) {
  const cwd = normalizeCwd(input.cwd);
  const slug = input.transcript.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "dschat";
  const fileName = `dschat-${slug}-${input.transcript.id.slice(-6)}.md`;
  const filePath = join3(cwd, fileName);
  mkdirSync3(cwd, { recursive: true });
  writeFileSync(filePath, renderTranscriptMarkdown(input.transcript), "utf8");
  return { filePath: basename(filePath) };
}

// src/routes.ts
var MAX_JSON_BODY_BYTES = 64 * 1024;
var MAX_RESTORE_BODY_BYTES = 24 * 1024 * 1024;
var MAX_ATTACHMENT_BODY_BYTES = 36 * 1024 * 1024;
var ATTACHMENT_DIR = "attachments";
var ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var MEDIA_EXTENSION = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/heic": ".heic",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/json": ".json",
  "application/rtf": ".rtf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/x-python": ".py",
  "application/javascript": ".js",
  "application/typescript": ".ts",
  "application/xml": ".xml",
  "application/yaml": ".yaml",
  "application/zip": ".zip",
  "application/gzip": ".gz"
};
var SAFE_EXTENSION = /^\.(png|jpg|jpeg|webp|gif|bmp|tiff|heic|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|markdown|csv|tsv|json|jsonl|log|xml|yaml|yml|htm|html|tex|rtf|srt|vtt|py|js|mjs|cjs|ts|tsx|jsx|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|sql|ini|toml|conf|cfg)$/;
function attachmentExtension(mediaType, name2) {
  const mapped = MEDIA_EXTENSION[mediaType.toLowerCase()];
  if (mapped !== void 0) return mapped;
  const fromName = extname(name2).toLowerCase();
  return SAFE_EXTENSION.test(fromName) ? fromName : ".bin";
}
var ATTACHMENT_LABEL_MAX_BYTES = 60;
function fileLabel(name2) {
  const flat = basename2(name2).replace(/[\u0000-\u001f\u007f]/g, "");
  const cleaned2 = flat.replace(/[/\\:*?"<>|]/g, "_").replace(/^\.+/, "").trim();
  if (cleaned2 === "") return "file";
  const bytes = Buffer.from(cleaned2, "utf8");
  if (bytes.length <= ATTACHMENT_LABEL_MAX_BYTES) return cleaned2;
  let end = ATTACHMENT_LABEL_MAX_BYTES;
  while (end > 0 && (bytes[end] & 192) === 128) end--;
  const truncated = bytes.subarray(0, end).toString("utf8").trim();
  return truncated === "" ? "file" : truncated;
}
function attachmentFileName(name2, mediaType) {
  const extension = attachmentExtension(mediaType, name2);
  const label = fileLabel(name2);
  const trimmed = label.toLowerCase().endsWith(extension.toLowerCase()) && label.length > extension.length ? label.slice(0, -extension.length) : label;
  return `${randomUUID3()}__${trimmed}${extension}`;
}
var EXTENSION_MEDIA = (() => {
  const table = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".heic": "image/heic",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsonl": "application/x-ndjson; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".yaml": "application/yaml; charset=utf-8",
    ".yml": "application/yaml; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".tex": "text/plain; charset=utf-8",
    ".rtf": "application/rtf",
    ".srt": "text/plain; charset=utf-8",
    ".vtt": "text/vtt; charset=utf-8"
  };
  for (const [mediaType, extension] of Object.entries(MEDIA_EXTENSION)) {
    if (table[extension] === void 0) table[extension] = mediaType;
  }
  return table;
})();
function labelOf(file) {
  const at = file.indexOf("__");
  return at === -1 ? file : file.slice(at + 2);
}
function referencedAttachments(store) {
  const referenced = /* @__PURE__ */ new Set();
  for (const chat of store.list()) {
    for (const message of chat.messages) {
      for (const path of message.attachments ?? []) referenced.add(path);
    }
  }
  return referenced;
}
function pruneAttachments(dir, referenced) {
  try {
    const cutoff = Date.now() - ATTACHMENT_TTL_MS;
    for (const entry of readdirSync(dir)) {
      const path = join4(dir, entry);
      if (referenced.has(path)) continue;
      try {
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
      } catch {
      }
    }
  } catch {
  }
}
function isLoopbackRequest(req) {
  const host = req.headers.host ?? "";
  const address = req.socket.remoteAddress ?? "";
  const loopbackHost = host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("[::1]");
  const loopbackAddr = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1" || address === void 0;
  return loopbackHost && loopbackAddr;
}
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "referrer-policy": "no-referrer" });
  res.end(payload);
}
function commonPrefixLength2(a, b) {
  if (a.length < b.length && b.startsWith(a)) return a.length;
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}
function tailDelta(previous, content, at) {
  const head = previous === void 0 || !Number.isInteger(at) || at !== previous.length ? 0 : commonPrefixLength2(previous, content);
  return { head, tail: content.slice(head) };
}
async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk;
    size += buffer.length;
    if (size > maxBytes) return void 0;
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function stringField(body, name2) {
  const value = body?.[name2];
  return typeof value === "string" && value !== "" ? value : void 0;
}
function makeRoutes(deps) {
  const { ctx, engine, store, distill, hostContext, exportDir } = deps;
  const guard = (req, res) => {
    if (isLoopbackRequest(req)) return true;
    writeJson(res, 403, { ok: false, error: "loopback only" });
    return false;
  };
  const stateView = async () => {
    const status = await engine.status();
    return {
      ok: true,
      engine: status.engine,
      engineError: status.engineError,
      loggedIn: status.loggedIn,
      pageUrl: status.pageUrl,
      deepThink: status.deepThink,
      search: status.search,
      busy: status.busy,
      preparingNewChat: status.preparingNewChat,
      busySince: status.busySince,
      lastError: status.lastError,
      lastErrorCode: status.lastErrorCode,
      // A store that failed to load or save: the panel says so once instead of
      // letting the history look quietly empty.
      storeWarning: store.storeWarning(),
      activeChatId: store.activeChat()?.id,
      chats: store.list()
    };
  };
  const tailSent = /* @__PURE__ */ new Map();
  const TAIL_SENT_LIMIT = 4;
  const tailView = (req) => {
    const query = new URL(req.url ?? "/", "http://x").searchParams;
    const requested = query.get("chat") ?? void 0;
    const chat = (requested === void 0 ? store.activeChat() : store.get(requested)) ?? store.activeChat();
    const base = {
      ok: true,
      chatId: chat?.id,
      activeChatId: store.activeChat()?.id,
      busy: engine.getBusy(),
      busySince: engine.getBusySince(),
      streaming: chat?.streaming === true,
      title: chat?.title,
      updatedAt: chat?.updatedAt,
      messageCount: chat?.messages.length
    };
    if (chat === void 0) return { ...base, message: null };
    const message = [...chat.messages].reverse().find((candidate) => candidate.role === "assistant");
    if (message === void 0) return { ...base, message: null };
    const content = message.content;
    const delta = tailDelta(tailSent.get(message.id), content, Number(query.get("at") ?? ""));
    tailSent.delete(message.id);
    tailSent.set(message.id, content);
    for (const key of tailSent.keys()) {
      if (tailSent.size <= TAIL_SENT_LIMIT) break;
      tailSent.delete(key);
    }
    return {
      ...base,
      message: {
        id: message.id,
        role: message.role,
        ts: message.ts,
        streaming: message.streaming === true,
        error: message.error,
        length: content.length,
        head: delta.head,
        tail: delta.tail,
        /*
         * The reasoning duration rides the tail from the moment the answer
         * starts: that is when the engine measures it, and the answer itself can
         * then stream for another minute with this feed as the panel's only
         * source. Absent for a reply with no reasoning (or one still thinking).
         */
        ...message.thinkingMs === void 0 ? {} : { thinkingMs: message.thinkingMs },
        /*
         * The citation table travels WHOLE on every tail, never as a delta:
         * numbering is positional, so a partially-patched table would point
         * citations at the wrong source. It is a few URLs per reply, and the
         * search step that fills it precedes the answer that cites it — which
         * is what makes a chip clickable the moment it renders.
         */
        ...message.sources === void 0 || message.sources.length === 0 ? {} : { sources: message.sources }
      }
    };
  };
  return [
    {
      kind: "exact",
      path: "/api/dsh-dschat/state",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        writeJson(res, 200, await stateView());
      }
    },
    {
      /**
       * The streaming feed.
       *
       * Deliberately answers WITHOUT calling `engine.status()`: that reads the
       * deep-think/search toggles out of the live page, i.e. one or two CDP
       * round trips into the very page the reply loop is polling. `/state` keeps
       * that job at its slow cadence; this route only reports flags the engine
       * already holds in memory.
       */
      kind: "exact",
      path: "/api/dsh-dschat/tail",
      handler: (req, res) => {
        if (!guard(req, res)) return;
        writeJson(res, 200, tailView(req));
      }
    },
    {
      // Host facts the panel cannot read from a Client service without guessing
      // its shape: the workspace list and the most recent session's cwd.
      kind: "exact",
      path: "/api/dsh-dschat/context",
      handler: (req, res) => {
        if (!guard(req, res)) return;
        const view = hostContext?.();
        writeJson(res, 200, { ok: true, workspaces: view?.workspaces ?? [], cwd: view?.cwd, settings: view?.settings });
      }
    },
    {
      /**
       * "I want to type": bring the page up in the right mode.
       *
       * The panel calls this from the composer's focus, from the online/offline
       * placeholder click and before a send that arrives while the engine is
       * down. It answers `loginWindow: true` when a visible window is waiting
       * for the user, which is the panel's cue NOT to ask for one as well.
       *
       * Deliberately not the same route as `open-login`: that one is the
       * explicit 「打开登录窗口」 action and the escalation. Collapsing the two is
       * what made a click open a login window that was almost never needed (the
       * profile is usually still authenticated) and then launch a second browser
       * for the actual chat.
       */
      kind: "exact",
      path: "/api/dsh-dschat/wake",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const result = await engine.wake();
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/open-login",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const result = await engine.openLoginWindow();
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/close-browser",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        await engine.disposeBrowser();
        writeJson(res, 200, { ok: true });
      }
    },
    {
      // Undo for delete: re-imports the transcript the panel still holds in
      // memory, so "撤销" restores the real conversation instead of a copy of
      // its title. Returns the new chat id.
      kind: "exact",
      path: "/api/dsh-dschat/restore",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req, MAX_RESTORE_BODY_BYTES);
        if (body === void 0) {
          writeJson(res, 413, {
            ok: false,
            error: `\u64A4\u9500\u5931\u8D25\uFF1A\u5BF9\u8BDD\u6570\u636E\u65E0\u6CD5\u8BFB\u53D6\uFF08\u8D85\u8FC7 ${Math.round(MAX_RESTORE_BODY_BYTES / (1024 * 1024))} MiB \u6216\u683C\u5F0F\u635F\u574F\uFF09\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u5185\u5BB9\u3002`
          });
          return;
        }
        const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
        if (messages.length === 0) {
          writeJson(res, 400, { ok: false, error: "\u64A4\u9500\u5931\u8D25\uFF1A\u6CA1\u6709\u53EF\u6062\u590D\u7684\u6D88\u606F\u3002" });
          return;
        }
        const webSessionId = stringField(body, "webSessionId");
        const result = store.importTranscript({
          title: stringField(body, "title") ?? "\u6062\u590D\u7684\u5BF9\u8BDD",
          model: stringField(body, "model") ?? "deepseek-chat",
          ...webSessionId === void 0 ? {} : { webSessionId },
          messages: [...messages]
        });
        writeJson(res, 200, { ok: true, chatId: result.chat.id, created: result.created });
      }
    },
    {
      // Paste / drop target: the browser has file BYTES, but the engine drives
      // the page's file input, which needs a real path. Persist the bytes under
      // the plugin's data dir and hand the path back, so attaching a file is
      // "drop it" instead of "type its absolute path".
      kind: "exact",
      path: "/api/dsh-dschat/attach",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req, MAX_ATTACHMENT_BODY_BYTES);
        const data = typeof body?.["data"] === "string" ? body["data"] : "";
        if (data === "") {
          writeJson(res, 400, { ok: false, error: "empty attachment body\uFF08\u6587\u4EF6\u6570\u636E\u4E3A\u7A7A\u6216\u8D85\u8FC7 24 MiB\uFF09" });
          return;
        }
        const bytes = Buffer.from(data, "base64");
        if (bytes.length === 0) {
          writeJson(res, 400, { ok: false, error: "attachment is not valid base64" });
          return;
        }
        const dir = join4(store.dataDir, ATTACHMENT_DIR);
        try {
          mkdirSync4(dir, { recursive: true });
          pruneAttachments(dir, referencedAttachments(store));
          const name2 = stringField(body, "name") ?? "pasted-file";
          const path = join4(dir, attachmentFileName(name2, stringField(body, "mediaType") ?? ""));
          writeFileSync2(path, bytes, { mode: 384 });
          writeJson(res, 200, { ok: true, path, bytes: bytes.length, name: name2 });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: `\u5199\u5165\u9644\u4EF6\u5931\u8D25\uFF1A${String(error)}` });
        }
      }
    },
    {
      /*
       * Read one stored attachment back, so the composer can show a real
       * THUMBNAIL for an image instead of a paperclip.
       *
       * The bytes travel over this route rather than a data URL carried in the
       * panel's state: a 24 MiB photo would otherwise sit base64-encoded (~33%
       * larger) in the composer, in every snapshot of it, and in the bundle's
       * own cached module. Going through the host also means a transcript
       * recovered from disk — which holds only the old, bare-UUID paths —
       * renders thumbnails exactly like a freshly pasted file.
       *
       * Trust fence: this serves a file from the plugin's own data directory,
       * so it carries the same loopback check as every other route, and the
       * path is CONTAINED to that directory before a byte is read — a
       * `../`-shaped path is answered 404 rather than followed.
       */
      kind: "exact",
      path: "/api/dsh-dschat/attachment",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const requested = new URL(req.url ?? "/", "http://x").searchParams.get("path") ?? "";
        if (requested === "") {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 path \u53C2\u6570" });
          return;
        }
        const dir = resolve(join4(store.dataDir, ATTACHMENT_DIR));
        const absolute = resolve(requested);
        if (!absolute.startsWith(`${dir}/`)) {
          writeJson(res, 404, { ok: false, error: "\u9644\u4EF6\u4E0D\u5728\u9644\u4EF6\u76EE\u5F55\u5185" });
          return;
        }
        const file = basename2(absolute);
        const mediaType = EXTENSION_MEDIA[extname(file).toLowerCase()] ?? "application/octet-stream";
        let bytes;
        try {
          bytes = readFileSync(absolute);
        } catch {
          writeJson(res, 404, { ok: false, error: "\u9644\u4EF6\u4E0D\u5B58\u5728" });
          return;
        }
        res.writeHead(200, {
          "content-type": mediaType,
          "content-length": String(bytes.length),
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(labelOf(file))}`,
          "cache-control": "private, max-age=300",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff"
        });
        res.end(bytes);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/new-chat",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const result = await engine.newChat();
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/send",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const text2 = stringField(body, "text");
        if (text2 === void 0) {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 text \u5B57\u6BB5" });
          return;
        }
        const images = Array.isArray(body?.["images"]) ? body["images"].filter((value) => typeof value === "string").map((value) => value) : void 0;
        const result = await engine.send(text2, false, images);
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/stop",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        await engine.stop();
        writeJson(res, 200, { ok: true });
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/deep-think",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const enabled = typeof body?.["enabled"] === "boolean" ? body["enabled"] : void 0;
        if (enabled === void 0) {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 enabled \u5B57\u6BB5" });
          return;
        }
        const result = await engine.setDeepThink(enabled);
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/search",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const enabled = typeof body?.["enabled"] === "boolean" ? body["enabled"] : void 0;
        if (enabled === void 0) {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 enabled \u5B57\u6BB5" });
          return;
        }
        const result = await engine.setSearch(enabled);
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/transfer",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const chatId = stringField(body, "chatId") ?? store.activeChat()?.id;
        const cwd = stringField(body, "cwd");
        const workspaceId = stringField(body, "workspaceId");
        const targetSessionId = stringField(body, "targetSessionId");
        const mode = body?.["mode"] === "raw" ? "raw" : body?.["mode"] === "distill" ? "distill" : void 0;
        const transcript = chatId === void 0 ? void 0 : store.getChat(chatId);
        if (transcript === void 0) {
          writeJson(res, 404, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u5BF9\u8BDD\u8BB0\u5F55" });
          return;
        }
        try {
          const workspace = workspaceId === void 0 ? void 0 : { workspaceId };
          const { sessionId, distilled, attached, workspaceId: attachedWorkspaceId, duplicate } = await transferToHarnessSession(ctx, { transcript, cwd, workspace, targetSessionId }, distill, mode);
          writeJson(res, 200, {
            ok: true,
            sessionId,
            distilled,
            attached,
            continued: targetSessionId !== void 0,
            // True when the brief was already in the target session and nothing
            // was appended: the panel says so instead of implying a new handoff.
            duplicate: duplicate === true,
            workspaceId: attachedWorkspaceId
          });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String(error) });
        }
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/export",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const chatId = stringField(body, "chatId") ?? store.activeChat()?.id;
        const cwd = stringField(body, "cwd") ?? exportDir();
        const transcript = chatId === void 0 ? void 0 : store.getChat(chatId);
        if (transcript === void 0) {
          writeJson(res, 404, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u5BF9\u8BDD\u8BB0\u5F55" });
          return;
        }
        try {
          const { filePath } = exportTranscriptFile({ transcript, cwd });
          writeJson(res, 200, { ok: true, filePath, dir: cwd });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String(error) });
        }
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/web-chats",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const web = await engine.listWebConversations();
        const imported = store.webSessionIds();
        const missing = web.filter((item) => item.sessionId === void 0 || !imported.has(item.sessionId));
        writeJson(res, 200, { ok: true, web, missing });
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/recover",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const title = stringField(body, "title");
        const sessionId = stringField(body, "sessionId");
        if (title === void 0 && sessionId === void 0) {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 title \u6216 sessionId \u5B57\u6BB5" });
          return;
        }
        const result = await engine.recoverWebConversation({
          ...title === void 0 ? {} : { title },
          ...sessionId === void 0 ? {} : { sessionId }
        });
        writeJson(res, result.ok ? 200 : 500, result);
      }
    },
    {
      /*
       * Scraper diagnostics. Read-only and loopback-fenced like every other
       * route; it reports what the live page contains so a failed recover can
       * be diagnosed without a debugger attached.
       */
      kind: "exact",
      path: "/api/dsh-dschat/probe-page",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        writeJson(res, 200, { ok: true, probe: await engine.probePage() });
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/rename",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const chatId = stringField(body, "chatId");
        const title = stringField(body, "title");
        if (chatId === void 0 || title === void 0) {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 chatId \u6216 title \u5B57\u6BB5" });
          return;
        }
        const renamed = store.renameChat(chatId, title);
        if (renamed === void 0) writeJson(res, 404, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u5BF9\u8BDD\u8BB0\u5F55" });
        else writeJson(res, 200, { ok: true });
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/delete",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const body = await readJsonBody(req);
        const chatId = stringField(body, "chatId");
        if (chatId === void 0) {
          writeJson(res, 400, { ok: false, error: "\u7F3A\u5C11 chatId \u5B57\u6BB5" });
          return;
        }
        const deleted = store.deleteChat(chatId);
        if (!deleted) writeJson(res, 404, { ok: false, error: "\u627E\u4E0D\u5230\u8BE5\u5BF9\u8BDD\u8BB0\u5F55" });
        else writeJson(res, 200, { ok: true });
      }
    },
    {
      kind: "exact",
      path: "/api/dsh-dschat/clear",
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const count = store.clearAllChats();
        writeJson(res, 200, { ok: true, count });
      }
    }
  ];
}

// src/store.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync2, renameSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";
import { randomUUID as randomUUID4 } from "node:crypto";
function defaultDataDir() {
  const home2 = process.env.DSH_HOME ?? process.env.HOME ?? ".";
  return join5(home2, ".dsh", "dsh-dschat");
}
var PERSIST_DEBOUNCE_MS = 1e3;
function ensureUniqueMessageIds(messages) {
  const seen = /* @__PURE__ */ new Map();
  const kept = [];
  let changed = false;
  for (const message of messages) {
    const id = typeof message.id === "string" ? message.id : "";
    const previous = id === "" ? void 0 : seen.get(id);
    if (previous === void 0) {
      const next2 = id === "" ? { ...message, id: randomUUID4() } : message;
      if (next2 !== message) changed = true;
      seen.set(next2.id, next2);
      kept.push(next2);
      continue;
    }
    changed = true;
    if (sameMessage(previous, message)) continue;
    const next = { ...message, id: randomUUID4() };
    seen.set(next.id, next);
    kept.push(next);
  }
  return { messages: kept, changed };
}
function sameMessage(left, right) {
  return left.role === right.role && left.content === right.content && left.ts === right.ts && JSON.stringify(left.sources ?? null) === JSON.stringify(right.sources ?? null);
}
var DEFAULT_CHAT_TITLE = "\u65B0\u7684\u5BF9\u8BDD";
var TranscriptStore = class {
  dataDir;
  file;
  chats;
  activeChatId;
  /** Pending coalesced write; undefined when everything is on disk. */
  persistTimer;
  /**
   * A load or write problem worth telling the reader about.
   *
   * The store used to fail silently in both directions: an unreadable file
   * became "no history" and was then overwritten by the next write, and a failed
   * write threw inside a `setTimeout` (an uncaught exception in the host). Both
   * are now recorded here and surfaced through `/state`, so the panel can say
   * what happened instead of the history quietly disappearing.
   */
  warning;
  constructor(options = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir();
    this.file = join5(this.dataDir, "transcripts.json");
    const loaded = this.read();
    this.chats = loaded.chats;
    this.activeChatId = loaded.activeChatId;
    if (this.activeChatId !== void 0 && !this.chats.some((chat) => chat.id === this.activeChatId)) {
      this.activeChatId = this.chats.at(0)?.id;
    }
    let repaired = false;
    for (const chat of this.chats) {
      const fixed = ensureUniqueMessageIds(chat.messages);
      if (!fixed.changed) continue;
      chat.messages = fixed.messages;
      repaired = true;
    }
    if (repaired) this.persist();
  }
  /** A store problem the UI should surface, or undefined when all is well. */
  storeWarning() {
    return this.warning;
  }
  /** Record (and log) a store problem, keeping the first one seen this session. */
  warn(message) {
    if (this.warning === void 0) this.warning = message;
    console.warn(`[dsh-dschat] ${message}`);
  }
  /**
   * Move an unreadable store aside so the next write cannot destroy it.
   *
   * Renaming (not deleting, not copying) is what makes this safe: whatever the
   * file contained stays on disk under a name the plugin will never overwrite,
   * and the reader can hand it back or repair it.
   */
  quarantine() {
    const target = `${this.file}.corrupt-${Date.now()}`;
    try {
      renameSync(this.file, target);
      return `\uFF0C\u539F\u6587\u4EF6\u5DF2\u5907\u4EFD\u4E3A ${target}`;
    } catch (error) {
      return `\uFF0C\u4E14\u5907\u4EFD\u5931\u8D25\uFF08${String(error)}\uFF09`;
    }
  }
  read() {
    let text2;
    try {
      text2 = readFileSync2(this.file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.warn(`\u8BFB\u53D6\u4F1A\u8BDD\u8BB0\u5F55\u5931\u8D25\uFF08${String(error)}\uFF09\u3002\u672C\u6B21\u4EE5\u7A7A\u5386\u53F2\u542F\u52A8\uFF0C\u539F\u6587\u4EF6\u672A\u88AB\u8986\u76D6\u3002`);
      }
      return { version: 1, chats: [] };
    }
    try {
      const parsed = JSON.parse(text2);
      const chats = Array.isArray(parsed.chats) ? parsed.chats : [];
      return {
        version: 1,
        activeChatId: typeof parsed.activeChatId === "string" ? parsed.activeChatId : void 0,
        chats: chats.filter((chat) => typeof chat?.id === "string" && Array.isArray(chat.messages))
      };
    } catch (error) {
      this.warn(`\u4F1A\u8BDD\u8BB0\u5F55\u6587\u4EF6\u65E0\u6CD5\u89E3\u6790\uFF08${String(error)}\uFF09${this.quarantine()}\u3002\u672C\u6B21\u4EE5\u7A7A\u5386\u53F2\u542F\u52A8\u3002`);
      return { version: 1, chats: [] };
    }
  }
  persist() {
    if (this.persistTimer !== void 0) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = void 0;
      this.writeNow();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }
  /**
   * Land every pending mutation immediately.
   *
   * Called when the process might be about to exit (the end of a turn, plugin
   * disposal) so coalescing can never be the reason a finished reply is lost.
   */
  flush() {
    if (this.persistTimer !== void 0) {
      clearTimeout(this.persistTimer);
      this.persistTimer = void 0;
    }
    this.writeNow();
  }
  /**
   * The atomic write itself: tmp file + rename, compact JSON.
   *
   * Failures are caught, not thrown: the debounced write runs from a bare
   * `setTimeout`, so a throw here (ENOSPC, EACCES, a read-only volume) escaped
   * as an uncaught exception in the HOST process — the plugin could take the app
   * down to report a full disk. The message is recorded and surfaced through
   * `/state` instead, and the in-memory history stays served.
   */
  writeNow() {
    try {
      mkdirSync5(this.dataDir, { recursive: true, mode: 448 });
      const payload = { version: 1, activeChatId: this.activeChatId, chats: this.chats };
      const tmp = `${this.file}.tmp`;
      writeFileSync3(tmp, JSON.stringify(payload), { mode: 384 });
      renameSync(tmp, this.file);
    } catch (error) {
      this.warn(`\u4FDD\u5B58\u4F1A\u8BDD\u8BB0\u5F55\u5931\u8D25\uFF08${String(error)}\uFF09\u3002\u672C\u6B21\u8FD0\u884C\u7684\u5386\u53F2\u53EA\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D\uFF0C\u5173\u95ED\u7A97\u53E3\u540E\u4F1A\u4E22\u5931\u3002`);
    }
  }
  /** Create a fresh chat and make it active. */
  createChat(model) {
    const now = Date.now();
    const chat = {
      id: `chat-${now.toString(36)}-${randomUUID4().slice(0, 6)}`,
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now,
      model,
      messages: [],
      streaming: false
    };
    this.chats.unshift(chat);
    this.activeChatId = chat.id;
    this.persist();
    return chat;
  }
  /** All chats, newest first. */
  list() {
    return [...this.chats];
  }
  /**
   * One chat by id.
   *
   * Exists for the streaming tail route, which must not call `list()`: copying
   * and then scanning 100+ transcripts on every 100 ms poll is exactly the kind
   * of whole-store work the tail endpoint was added to avoid.
   */
  get(id) {
    return this.chats.find((chat) => chat.id === id);
  }
  /**
   * Import (or refresh) a recovered web conversation. Returns the chat, plus
   * whether it was created and whether an existing one was overwritten.
   *
   * Matching is by web session id first and exact title second. The title-only
   * dedup this replaces made re-syncing "idempotent" in the worst way: an
   * import that had been truncated (the old scraper only saw the rows the
   * virtual list had mounted) could never be repaired, because the second
   * recover matched the title and returned the short transcript unchanged.
   *
   * An existing transcript is only ever UPGRADED — a recover that comes back
   * with fewer bytes never truncates what is already stored.
   */
  importTranscript(input) {
    const cleanTitle = input.title.trim().replace(/\s+/g, " ").slice(0, 80) || DEFAULT_CHAT_TITLE;
    const incoming = ensureUniqueMessageIds(input.messages).messages;
    const existing = this.findForImport(cleanTitle, input.webSessionId, input.matchByTitle === true);
    if (existing !== void 0) {
      let changed = this.activeChatId !== existing.id;
      this.activeChatId = existing.id;
      if (input.webSessionId !== void 0 && existing.webSessionId !== input.webSessionId) {
        existing.webSessionId = input.webSessionId;
        changed = true;
      }
      const updated = this.isFuller(incoming, existing.messages);
      if (updated) {
        existing.messages = incoming;
        existing.updatedAt = Date.now();
        changed = true;
      }
      if (changed) this.persist();
      return { chat: existing, created: false, updated };
    }
    const now = Date.now();
    const chat = {
      id: `chat-${now.toString(36)}-${randomUUID4().slice(0, 6)}`,
      title: cleanTitle,
      createdAt: now,
      updatedAt: now,
      model: input.model,
      messages: incoming,
      streaming: false,
      ...input.webSessionId === void 0 ? {} : { webSessionId: input.webSessionId }
    };
    this.chats.unshift(chat);
    this.activeChatId = chat.id;
    this.persist();
    return { chat, created: true, updated: false };
  }
  /**
   * Which stored chat an incoming import belongs to.
   *
   * By web session id first, and — only when the caller asked for it and there
   * is no id — by title. The title branch additionally refuses the default
   * title and refuses chats that are already tied to a known web conversation,
   * so it can only ever re-attach an id-less import to another id-less
   * transcript with a real, matching name.
   */
  findForImport(title, webSessionId, matchByTitle) {
    if (webSessionId !== void 0 && webSessionId !== "") {
      const byId = this.chats.find((chat) => chat.webSessionId === webSessionId);
      if (byId !== void 0) return byId;
    }
    if (!matchByTitle || title === DEFAULT_CHAT_TITLE) return void 0;
    return this.chats.find((chat) => chat.title === title && chat.webSessionId === void 0);
  }
  /**
   * True when the incoming history carries more than what is stored.
   * Message count decides first (a 2-message import of a 32-message
   * conversation is the failure being repaired); equal counts need a real size
   * increase so a re-recover with identical content does not churn the file.
   */
  isFuller(next, current) {
    if (current.length === 0) return next.length > 0;
    if (next.length !== current.length) return next.length > current.length;
    const size = (messages) => messages.reduce((total, message) => total + message.content.length, 0);
    return size(next) > size(current);
  }
  /** Web session ids already imported (so the sidebar can mark the rest). */
  webSessionIds() {
    const ids = /* @__PURE__ */ new Set();
    for (const chat of this.chats) if (chat.webSessionId !== void 0) ids.add(chat.webSessionId);
    return ids;
  }
  /** The active chat, or undefined when none exists yet. */
  activeChat() {
    if (this.activeChatId === void 0) return void 0;
    return this.chats.find((chat) => chat.id === this.activeChatId);
  }
  /** Read one chat by id. */
  getChat(id) {
    return this.chats.find((chat) => chat.id === id);
  }
  /** Pick the active chat, creating one if none exists. */
  ensureActiveChat(model) {
    return this.activeChat() ?? this.createChat(model);
  }
  /** Set which chat is active. */
  setActiveChat(id) {
    if (!this.chats.some((chat) => chat.id === id)) return false;
    this.activeChatId = id;
    this.persist();
    return true;
  }
  /** Mutate the active (or named) chat and persist. */
  update(id, mutate) {
    const chat = this.chats.find((candidate) => candidate.id === id);
    if (chat === void 0) return void 0;
    mutate(chat);
    chat.updatedAt = Date.now();
    this.persist();
    return chat;
  }
  /** Append a message to a chat. */
  appendMessage(id, message) {
    return this.update(id, (chat) => {
      const unique = chat.messages.some((existing) => existing.id === message.id) ? { ...message, id: randomUUID4() } : message;
      chat.messages.push(unique);
      if (unique.role === "assistant") chat.streaming = unique.streaming ?? false;
    });
  }
  /** Replace (or insert) one message by id — used for streaming updates. */
  upsertMessage(id, message) {
    return this.update(id, (chat) => {
      const index = chat.messages.findIndex((candidate) => candidate.id === message.id);
      if (index >= 0) chat.messages[index] = message;
      else chat.messages.push(message);
      if (message.role === "assistant") chat.streaming = message.streaming ?? false;
    });
  }
  /** Mark the chat's streaming flag (assistant reply started/stopped). */
  setStreaming(id, streaming, model) {
    return this.update(id, (chat) => {
      chat.streaming = streaming;
      if (model !== void 0) chat.model = model;
    });
  }
  /** Rename a chat (used to pin a meaningful title after the first exchange). */
  renameChat(id, title) {
    const clean = title.trim().replace(/\s+/g, " ").slice(0, 80);
    if (clean === "") return void 0;
    return this.update(id, (chat) => {
      chat.title = clean;
    });
  }
  /** Delete one chat; a deleted active chat falls back to the newest remaining. */
  deleteChat(id) {
    const before = this.chats.length;
    this.chats = this.chats.filter((chat) => chat.id !== id);
    if (this.chats.length === before) return false;
    if (this.activeChatId === id) this.activeChatId = this.chats.at(0)?.id;
    this.persist();
    return true;
  }
  /** Delete every chat; returns the number removed. */
  clearAllChats() {
    const count = this.chats.length;
    if (count === 0) return 0;
    this.chats = [];
    this.activeChatId = void 0;
    this.persist();
    return count;
  }
};

// src/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
function errorCodeHint(code) {
  switch (code) {
    case "NEED_LOGIN":
      return "\u9700\u8981\u5148\u767B\u5F55\uFF1A\u8BF7\u5728\u63D2\u4EF6\u9762\u677F\u70B9\u51FB\u300C\u6253\u5F00\u767B\u5F55\u7A97\u53E3\u300D\u5B8C\u6210 DeepSeek \u7F51\u9875\u767B\u5F55\u3002";
    case "PAGE_CHANGED":
      return "\u9875\u9762/\u534F\u8BAE\u7591\u4F3C\u6539\u7248\uFF1A\u8BF7\u5347\u7EA7 dsh-dschat \u63D2\u4EF6\u3002";
    case "TIMEOUT":
      return "\u751F\u6210\u8D85\u65F6\uFF1A\u53EF\u7A0D\u540E\u91CD\u8BD5\u3002";
    case "NETWORK":
      return "\u7F51\u7EDC/\u6D4F\u89C8\u5668\u9519\u8BEF\uFF1A\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u6D4F\u89C8\u5668\u662F\u5426\u53EF\u7528\u3002";
    case "BUSY":
      return "\u4E0A\u4E00\u6761\u56DE\u590D\u4ECD\u5728\u751F\u6210\uFF1A\u8BF7\u7B49\u5F85\u5B83\u7ED3\u675F\u6216\u5148\u8C03\u7528 dschat \u505C\u6B62\uFF0C\u518D\u91CD\u8BD5\u3002";
    default:
      return "";
  }
}
function text(value) {
  return [{ type: "text", text: value }];
}
function renderChats(store) {
  const chats = store.list();
  if (chats.length === 0) return "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u7F51\u9875\u7AEF\u5BF9\u8BDD\u8BB0\u5F55";
  return chats.map((chat) => {
    const messages = chat.messages.length;
    const last = chat.messages.at(-1);
    const preview = last === void 0 ? "" : ` \xB7 \u6700\u540E: ${last.content.replace(/\s+/g, " ").slice(0, 60)}`;
    return `${chat.id} | ${chat.title} | ${chat.model} | ${messages} \u6761\u6D88\u606F | ${new Date(chat.updatedAt).toLocaleString()}${preview}`;
  }).join("\n");
}
function dschatStatusTool(engine, store, listWorkspaces) {
  return defineTool({
    name: "dschat_status",
    description: "Report the DeepSeek \u7F51\u9875\u7AEF (chat.deepseek.com) web-chat state: engine status, login state, active chat, stored transcripts, and the harness workspaces available as dschat_transfer targets. Triggers: webchat, deepseek \u7F51\u9875\u7AEF, \u7F51\u9875\u804A\u5929. Use before dschat_send to confirm login.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          report: { type: "string", required: true }
        }
      },
      render: (_args, value) => text(value.report ?? "")
    },
    async execute() {
      const status = await engine.status();
      const active = store.activeChat();
      const lines = [
        `engine: ${status.engine}${status.engineError !== void 0 ? ` (${status.engineError})` : ""}`,
        `loggedIn: ${String(status.loggedIn)}`,
        `pageUrl: ${status.pageUrl ?? "-"}`,
        `deepThink: ${String(status.deepThink)}`,
        `search: ${String(status.search)}`,
        `busy: ${String(status.busy)}`,
        `activeChat: ${active === void 0 ? "-" : `${active.id} (${active.title})`}`,
        `chats:
${renderChats(store)}`
      ];
      const web = await engine.listWebConversations().catch(() => []);
      if (web.length > 0) {
        const imported = store.webSessionIds();
        const missing = web.filter((item) => item.sessionId === void 0 || !imported.has(item.sessionId));
        lines.push(`dschats:
${web.map((item) => `  - ${item.title}${item.sessionId === void 0 ? "" : ` [${item.sessionId}]`}`).join("\n")}`);
        if (missing.length > 0) {
          lines.push(`dschatsNotImported (use dschat_recover):
${missing.map((item) => `  - ${item.title}`).join("\n")}`);
        }
      }
      const workspaces = listWorkspaces?.();
      if (workspaces !== void 0) {
        lines.push("workspaces:");
        if (workspaces.length === 0) lines.push("  (none)");
        else for (const ws of workspaces) lines.push(`  ${ws.id} | ${ws.title} | ${ws.path}`);
      }
      return { report: lines.join("\n") };
    }
  });
}
function dschatSendTool(engine) {
  return defineTool({
    name: "dschat_send",
    description: "Send one message through the DeepSeek \u7F51\u9875\u7AEF (chat.deepseek.com) using the web model \u2014 your web session, no API billing. The assistant reply streams until complete and returns as markdown. Optionally attach local image files (absolute paths) for multimodal prompts. Requires the user to have logged into the web chat once (dschat_status \u2192 loggedIn true). Best for asking the web model to explain/design/review; do not use for file operations. Triggers: \u7F51\u9875\u7AEF\u63D0\u95EE, deepseek web, chatgpt mode.",
    parameters: {
      text: { type: "string", required: true, description: "The message to send to deepseek-chat on the web." },
      images: { type: "array", items: { type: "string" }, description: "Optional local absolute paths of image files to attach (multimodal prompt)." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reply: { type: "string", required: true },
          error: { type: "string" },
          code: { type: "string" },
          partial: { type: "boolean" }
        }
      },
      render: (_args, value) => {
        const partial = value.partial === true;
        const hint = errorCodeHint(value.code);
        return text([
          `dschat_send: \u5DF2\u901A\u8FC7 DeepSeek \u7F51\u9875\u7AEF\u53D1\u9001\u5E76\u6536\u5230\u56DE\u590D${partial ? "\uFF08\u751F\u6210\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF09" : ""}`,
          value.error !== void 0 ? `\uFF08\u6CE8\u610F\uFF1A${value.error}\uFF09` : "",
          hint !== "" ? `\uFF08${hint}\uFF09` : "",
          "",
          "--- \u7F51\u9875\u7AEF\u56DE\u590D ---",
          (value.reply ?? "").trim() === "" ? "\uFF08\u7A7A\u56DE\u590D\uFF09" : (value.reply ?? "").trim(),
          "--- \u56DE\u590D\u7ED3\u675F ---",
          "",
          "\u4F1A\u8BDD\u5DF2\u4FDD\u5B58\uFF0C\u53EF\u7528 dschat_transfer \u5C06\u6574\u6BB5\u5BF9\u8BDD\u8F6C\u79FB\u5230 harness \u4F1A\u8BDD\u3002"
        ].join("\n"));
      }
    },
    async execute(args) {
      const textValue = typeof args?.text === "string" ? args.text.trim() : "";
      if (textValue === "") return { reply: "", error: "\u7F3A\u5C11 text \u53C2\u6570", partial: false };
      const images = Array.isArray(args?.images) ? args.images.filter((value) => typeof value === "string").map((value) => value) : void 0;
      const result = await engine.send(textValue, true, images);
      return {
        reply: result.reply ?? "",
        partial: result.error !== void 0,
        // Omit the absent fields: `undefined` own properties make the value
        // non-lossless-JSON, so the harness would reject the result of every
        // SUCCESSFUL send with "value is not lossless JSON".
        ...result.error === void 0 ? {} : { error: result.error },
        ...result.code === void 0 ? {} : { code: result.code }
      };
    }
  });
}
function dschatRecoverTool(engine) {
  return defineTool({
    name: "dschat_recover",
    description: "Recover a DeepSeek \u7F51\u9875\u7AEF conversation into the local store so it can be imported/transferred. Reads the conversation's own history (whole transcript, including reasoning, in one request) and refreshes an existing local transcript when the recovered history is fuller. With no title or sessionId, lists the web-side conversations. Triggers: \u540C\u6B65\u7F51\u9875\u4F1A\u8BDD, \u6062\u590D\u7F51\u9875\u5BF9\u8BDD, sync webchat.",
    parameters: {
      title: { type: "string", description: "Conversation title (from the web sidebar or dschat_status dschats list). Omit to list web conversations." },
      sessionId: { type: "string", description: "Web session id from dschat_status (the [id] after a title). Preferred over title: titles repeat, ids do not." }
    },
    output: {
      schema: { type: "object", additionalProperties: false, properties: { report: { type: "string", required: true } } },
      render: (_args, value) => text(value.report ?? "")
    },
    async execute(args) {
      const title = typeof args?.title === "string" ? args.title.trim() : "";
      const sessionId = typeof args?.sessionId === "string" ? args.sessionId.trim() : "";
      if (title !== "" || sessionId !== "") {
        const result = await engine.recoverWebConversation({
          ...title === "" ? {} : { title },
          ...sessionId === "" ? {} : { sessionId }
        });
        if (!result.ok) return { report: `dschat_recover: \u6062\u590D\u5931\u8D25 \u2014 ${result.error ?? ""}` };
        const action = result.created === true ? "\u5DF2\u6062\u590D" : result.updated === true ? "\u5DF2\u5237\u65B0\uFF08\u539F\u8BB0\u5F55\u4E0D\u5B8C\u6574\uFF09" : "\u672C\u5730\u5DF2\u662F\u6700\u65B0";
        return {
          report: `dschat_recover: ${action}\u300C${result.title ?? title}\u300D\u4E3A\u672C\u5730\u5BF9\u8BDD ${result.chatId ?? ""}\uFF0C\u5171 ${String(result.messageCount ?? 0)} \u6761\u6D88\u606F\uFF08\u6765\u6E90\uFF1A${result.source ?? "-"}\uFF09${result.sessionId === void 0 ? "" : `\uFF0CsessionId ${result.sessionId}`}\u3002\u53EF\u7528 dschat_transfer \u8F6C\u79FB\u3002`
        };
      }
      const web = await engine.listWebConversations().catch(() => []);
      if (web.length === 0) return { report: "dschat_recover: \u672A\u5728\u7F51\u9875\u7AEF\u8BFB\u5230\u4F1A\u8BDD\uFF08\u53EF\u80FD\u672A\u767B\u5F55\u6216\u9875\u9762\u5DF2\u6539\u7248\uFF09" };
      return { report: web.map((item) => `- ${item.title}${item.sessionId === void 0 ? "" : ` [${item.sessionId}]`}`).join("\n") };
    }
  });
}
function dschatImportTool(store) {
  return defineTool({
    name: "dschat_import",
    description: "Import one stored DeepSeek \u7F51\u9875\u7AEF transcript as markdown so the agent can continue the discussion itself. Triggers: \u8BFB\u53D6\u7F51\u9875\u5BF9\u8BDD, import webchat, \u628A\u7F51\u9875\u804A\u5929\u4F5C\u4E3A\u4E0A\u4E0B\u6587. Use dschat_status to list chat ids first.",
    parameters: {
      chatId: { type: "string", description: "Transcript id (from dschat_status). Omit for the active chat." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          transcript: { type: "string", required: true },
          error: { type: "string" }
        }
      },
      render: (_args, value) => {
        if (value.error !== void 0) return text(value.error);
        return text(value.transcript ?? "");
      }
    },
    async execute(args) {
      const chat = typeof args?.chatId === "string" ? store.getChat(args.chatId) : store.activeChat();
      if (chat === void 0) return { transcript: "", error: "dschat_import: \u627E\u4E0D\u5230\u5BF9\u8BDD\u8BB0\u5F55\uFF08\u7528 dschat_status \u67E5\u770B\u5217\u8868\uFF09" };
      return { transcript: renderTranscriptMarkdown(chat) };
    }
  });
}
function dschatTransferTool(hostCtx, store, distill) {
  return defineTool({
    name: "dschat_transfer",
    description: "Transfer a stored DeepSeek \u7F51\u9875\u7AEF transcript into harness mode: distills the web conversation into an executable task brief (goal, established context, current state, next steps) and creates a NEW harness session whose first message is that brief (not the raw chat log), OR appends it as a fresh user message to an EXISTING session via targetSessionId (continue the same task). Optionally target a workspace (workspaceId from dschat_status workspaces list) so the new session is grouped under it. Returns the (new or target) session id. Triggers: \u8F6C\u79FB\u5230 harness, \u8F6C\u6210\u5F00\u53D1\u4F1A\u8BDD, transfer webchat.",
    parameters: {
      chatId: { type: "string", description: "Transcript id (from dschat_status). Omit for the active chat." },
      targetSessionId: { type: "string", description: "Optional existing harness session id to CONTINUE (append the brief as a new user message) instead of creating a new session. Omit to create a new session." },
      workspaceId: { type: "string", description: "Optional target workspace id (from the workspaces list in dschat_status). Omit to leave the new session ungrouped. Ignored when targetSessionId is given." },
      cwd: { type: "string", description: "Optional absolute working directory for the new session; ignored when workspaceId or targetSessionId is given." }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sessionId: { type: "string", required: true },
          distilled: { type: "boolean" },
          attached: { type: "boolean" },
          continued: { type: "boolean" },
          workspaceId: { type: "string" },
          error: { type: "string" }
        }
      },
      render: (_args, value) => {
        if (value.error !== void 0) return text(value.error);
        const note = value.distilled === true ? "\uFF08\u5DF2\u84B8\u998F\u4E3A\u4EFB\u52A1\u7B80\u62A5\uFF09" : "\uFF08\u84B8\u998F\u4E0D\u53EF\u7528\uFF0C\u5DF2\u56DE\u9000\u4E3A\u539F\u59CB\u5BF9\u8BDD\u8BB0\u5F55\uFF09";
        if (value.continued === true) {
          return text(`dschat_transfer: \u5DF2\u628A\u7F51\u9875\u5BF9\u8BDD\u4F5C\u4E3A\u65B0\u7684\u7528\u6237\u6D88\u606F\u5EF6\u7EED\u5230 harness \u4F1A\u8BDD ${value.sessionId ?? ""}${note}\u3002\u8BF7\u544A\u77E5\u7528\u6237\u6253\u5F00\u8BE5\u4F1A\u8BDD\u7EE7\u7EED\u5F00\u53D1\u3002`);
        }
        const where = value.workspaceId !== void 0 ? `\u5DF2\u5F52\u5165\u5DE5\u4F5C\u533A ${value.workspaceId}` : "\u672A\u5206\u7EC4";
        return text(`dschat_transfer: \u5DF2\u521B\u5EFA\u65B0 harness \u4F1A\u8BDD ${value.sessionId ?? ""}${note}\uFF08${where}\uFF09\u3002\u8BF7\u544A\u77E5\u7528\u6237\u4ECE\u4FA7\u8FB9\u680F\u6253\u5F00\u8BE5\u4F1A\u8BDD\u7EE7\u7EED\u5F00\u53D1\u3002`);
      }
    },
    async execute(args) {
      const chat = typeof args?.chatId === "string" ? store.getChat(args.chatId) : store.activeChat();
      if (chat === void 0) return { sessionId: "", distilled: false, attached: false, error: "dschat_transfer: \u627E\u4E0D\u5230\u5BF9\u8BDD\u8BB0\u5F55\uFF08\u7528 dschat_status \u67E5\u770B\u5217\u8868\uFF09" };
      const targetSessionId = typeof args?.targetSessionId === "string" && args.targetSessionId !== "" ? args.targetSessionId : void 0;
      const workspace = targetSessionId === void 0 && typeof args?.workspaceId === "string" && args.workspaceId !== "" ? { workspaceId: args.workspaceId } : void 0;
      try {
        const { sessionId, distilled, attached, workspaceId, duplicate } = await transferToHarnessSession(hostCtx, { transcript: chat, cwd: args?.cwd, workspace, targetSessionId }, distill);
        return {
          sessionId,
          distilled,
          attached,
          continued: targetSessionId !== void 0,
          // Omit rather than set `undefined`: an own property holding undefined
          // is not lossless JSON, and the harness rejects the ENTIRE tool result
          // ("value is not lossless JSON") even though the transfer succeeded.
          // The continue-an-existing-session branch never has a workspace.
          ...workspaceId === void 0 ? {} : { workspaceId },
          // True when this brief was already in the target session and nothing
          // was written — a retry, not a second round.
          ...duplicate === void 0 ? {} : { duplicate }
        };
      } catch (error) {
        return { sessionId: "", distilled: false, attached: false, continued: targetSessionId !== void 0, error: `dschat_transfer: \u8F6C\u79FB\u5931\u8D25 \u2014 ${String(error)}` };
      }
    }
  });
}

// src/index.ts
var name = "dschat";
var inject = ["webServer", "tools", "systemPrompt", "sessions"];
var Config = import_schemastery.default.object({
  announceToAgent: import_schemastery.default.boolean().default(true),
  enabled: import_schemastery.default.boolean().default(true),
  browserChannel: import_schemastery.default.string().default("auto"),
  browserExecutablePath: import_schemastery.default.string().default(""),
  browserProxy: import_schemastery.default.string().default("direct"),
  browserHeadless: import_schemastery.default.boolean().default(true),
  replyTimeoutMs: import_schemastery.default.number().default(18e4),
  dataDir: import_schemastery.default.string().default(""),
  profileDir: import_schemastery.default.string().default(""),
  exportDir: import_schemastery.default.string().default(""),
  transferDistill: import_schemastery.default.boolean().default(true),
  transferProvider: import_schemastery.default.string().default(""),
  transferModel: import_schemastery.default.string().default(""),
  transferMaxTokens: import_schemastery.default.number().default(4096),
  transferChunkTokens: import_schemastery.default.number().default(1024)
});
var DEFAULT_ANNOUNCE = true;
var SECTION_ORDER = 155;
var DSCHAT_GUIDANCE = "\u672C\u673A\u5DF2\u5B89\u88C5 dsh-DSchat \u63D2\u4EF6\uFF08DeepSeek \u7F51\u9875\u7AEF\u804A\u5929 + \u8FC1\u79FB\u5230 harness\uFF09\uFF1A\u5728\u4FA7\u8FB9\u680F\u300CDSchat\u300D\u9762\u677F\u5165\u53E3\u6253\u5F00\u539F\u751F\u4E2D\u5FC3\u9762\u677F\uFF08\u4E0D\u518D\u662F DOM \u6CE8\u5165\u7684\u6D6E\u5C42\uFF09\u3002\u5B83\u901A\u8FC7\u771F\u5B9E\u6D4F\u89C8\u5668\u9A71\u52A8 chat.deepseek.com\uFF0C\u7528\u7F51\u9875\u767B\u5F55\u4F1A\u8BDD\u4E0E DeepSeek \u7F51\u9875\u6A21\u578B\u5BF9\u8BDD\uFF0C\u65E0\u9700 API \u989D\u5EA6\uFF1B\u652F\u6301\u6DF1\u5EA6\u601D\u8003/\u667A\u80FD\u641C\u7D22\u5F00\u5173\u3001\u56FE\u7247\u9644\u4EF6\uFF08\u62D6\u62FD\u6216\u7C98\u8D34\uFF09\u3001\u4F1A\u8BDD\u641C\u7D22\u4E0E\u6D88\u606F\u7EA7\u64CD\u4F5C\u3002\u80FD\u529B\uFF1Adschat_status \u67E5\u770B\u767B\u5F55/\u5F15\u64CE/\u4F1A\u8BDD\u72B6\u6001\u3001dschat_send \u901A\u8FC7\u7F51\u9875\u7AEF\u53D1\u9001\u6D88\u606F\u5E76\u6D41\u5F0F\u83B7\u53D6\u56DE\u590D\uFF08\u53EF\u9644\u5E26\u672C\u5730\u56FE\u7247\u8DEF\u5F84\u505A\u591A\u6A21\u6001\u63D0\u95EE\uFF09\u3001dschat_recover \u628A\u7F51\u9875\u7AEF\u5DF2\u6709\u4F1A\u8BDD\u540C\u6B65/\u6062\u590D\u5230\u672C\u5730\u3001dschat_import \u628A\u5B58\u50A8\u7684\u7F51\u9875\u5BF9\u8BDD\u5BFC\u5165\u4E3A markdown \u4E0A\u4E0B\u6587\u3001dschat_transfer \u628A\u7F51\u9875\u5BF9\u8BDD\u84B8\u998F\u6210\u53EF\u6267\u884C\u4EFB\u52A1\u7B80\u62A5\u5E76\u521B\u5EFA\u65B0 harness \u4F1A\u8BDD\uFF08\u9996\u6761\u6D88\u606F\u5373\u4EFB\u52A1\u7B80\u62A5\uFF0C\u800C\u975E\u539F\u59CB\u804A\u5929\u8BB0\u5F55\uFF09\uFF0C\u6216\u7ECF targetSessionId \u628A\u7B80\u62A5\u4F5C\u4E3A\u65B0\u6D88\u606F\u8FFD\u52A0\u5230\u5DF2\u6709\u4F1A\u8BDD\u5EF6\u7EED\u540C\u4E00\u4EFB\u52A1\u3002\u9762\u677F\u5934\u90E8\u300C\u5728 Harness \u4E2D\u7EE7\u7EED\u300D\u63D0\u4F9B\u540C\u6837\u7684\u8FC1\u79FB\uFF08\u53EF\u9009\u84B8\u998F\u7B80\u62A5 / \u539F\u6587\u8FC1\u79FB\u3001\u76EE\u6807\u5DE5\u4F5C\u533A\u3001\u8FFD\u52A0\u5230\u5DF2\u6709\u4F1A\u8BDD\uFF09\uFF0C\u8FC1\u79FB\u5B8C\u6210\u540E\u81EA\u52A8\u6253\u5F00\u65B0\u4F1A\u8BDD\u3002\u9650\u5236\uFF1A\u9996\u6B21\u4F7F\u7528\u9700\u7528\u6237\u5728\u5F39\u51FA\u7684\u6D4F\u89C8\u5668\u7A97\u53E3\u5B8C\u6210 DeepSeek \u7F51\u9875\u767B\u5F55\uFF1B\u7F51\u9875\u7AEF\u53D7 DeepSeek \u5B98\u65B9\u98CE\u63A7\uFF0C\u64CD\u4F5C\u5931\u8D25\u6216\u9875\u9762\u6539\u7248\u65F6\u8FD4\u56DE\u9519\u8BEF\u800C\u975E\u5D29\u6E83\u3002\u7528\u6237\u63D0\u5230\u300CDSchat / \u7F51\u9875\u804A\u5929 / \u7F51\u9875\u7AEF / ChatGPT \u6A21\u5F0F / deepseek web / \u8F6C\u79FB\u5230 harness\u300D\u65F6\u5373\u6307\u672C\u63D2\u4EF6\uFF0C\u8BF7\u636E\u6B64\u534F\u4F5C\u3002";
function dshHome() {
  return process.env.DSH_HOME ?? process.env.HOME ?? ".";
}
function defaultDataDirOf() {
  return `${dshHome()}/.dsh/dsh-dschat`;
}
function defaultProfileDirOf(dataDir) {
  const legacy = `${dshHome()}/.dsh/dsh-webchat/browser-profile`;
  return existsSync2(legacy) ? legacy : `${dataDir}/browser-profile`;
}
function engineConfigOf(resolve2) {
  const value = resolve2();
  const dataDir = value.dataDir?.trim() !== "" && value.dataDir !== void 0 ? value.dataDir.trim() : defaultDataDirOf();
  const configuredProfile = value.profileDir?.trim() ?? "";
  return {
    dataDir,
    profileDir: configuredProfile !== "" ? configuredProfile : defaultProfileDirOf(dataDir),
    channel: value.browserChannel === "auto" ? void 0 : value.browserChannel || void 0,
    executablePath: value.browserExecutablePath !== "" ? value.browserExecutablePath : void 0,
    proxy: value.browserProxy,
    headless: value.browserHeadless,
    replyTimeoutMs: value.replyTimeoutMs
  };
}
function apply(ctx, config) {
  const current = () => config ?? {};
  const resolve2 = () => ({
    announceToAgent: current().announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: current().enabled ?? true,
    browserChannel: current().browserChannel ?? "auto",
    browserExecutablePath: current().browserExecutablePath ?? "",
    browserProxy: current().browserProxy ?? "direct",
    browserHeadless: current().browserHeadless ?? true,
    replyTimeoutMs: current().replyTimeoutMs ?? 18e4,
    dataDir: current().dataDir ?? "",
    profileDir: current().profileDir ?? "",
    exportDir: current().exportDir ?? "",
    transferDistill: current().transferDistill ?? true,
    transferProvider: current().transferProvider ?? "",
    transferModel: current().transferModel ?? "",
    transferMaxTokens: current().transferMaxTokens ?? 4096,
    transferChunkTokens: current().transferChunkTokens ?? 1024
  });
  const distillConfigOf = (value) => ({
    distill: value.transferDistill ?? true,
    provider: (value.transferProvider ?? "").trim(),
    model: (value.transferModel ?? "").trim(),
    maxTokens: value.transferMaxTokens ?? 4096,
    chunkTokens: value.transferChunkTokens ?? 1024
  });
  const dataDir = resolve2().dataDir?.trim() !== "" && resolve2().dataDir !== void 0 ? resolve2().dataDir.trim() : defaultDataDirOf();
  const store = new TranscriptStore({ dataDir });
  const engine = new DeepSeekWebEngine(store, engineConfigOf(resolve2));
  ctx.effect(() => () => {
    store.flush();
    void engine.disposeBrowser();
  }, "dsh-dschat: engine");
  const listWorkspaces = () => {
    const registry = ctx.get("workspaceRegistry");
    if (registry === void 0) return void 0;
    return registry.list().map((ws) => ({ id: ws.id, path: ws.path, title: ws.title }));
  };
  const hostContext = () => {
    const value = resolve2();
    const dataDir2 = value.dataDir?.trim() !== "" && value.dataDir !== void 0 ? value.dataDir.trim() : defaultDataDirOf();
    const settings = {
      browserChannel: value.browserChannel ?? "auto",
      browserExecutablePath: value.browserExecutablePath ?? "",
      browserProxy: value.browserProxy ?? "direct",
      browserHeadless: value.browserHeadless ?? true,
      replyTimeoutMs: value.replyTimeoutMs ?? 18e4,
      dataDir: dataDir2,
      profileDir: engineConfigOf(resolve2).profileDir ?? "",
      /*
       * The export target as a RESOLVED path, not the raw setting: the settings
       * page has to show where a file actually went, and the panel's toast says
       * the same thing. An empty setting resolves to ~/Downloads here rather
       * than in two places.
       */
      exportDir: resolveExportDir(value.exportDir),
      transferDistill: value.transferDistill ?? true,
      transferProvider: (value.transferProvider ?? "").trim(),
      transferModel: (value.transferModel ?? "").trim(),
      announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE
    };
    const live = ctx.get("sessions")?.list() ?? [];
    for (let i = live.length - 1; i >= 0; i--) {
      const cwd = live[i]?.header?.cwd;
      if (typeof cwd === "string" && cwd !== "") return { workspaces: listWorkspaces() ?? [], cwd, settings };
    }
    return { workspaces: listWorkspaces() ?? [], settings };
  };
  const routes = makeRoutes({
    ctx,
    engine,
    store,
    distill: distillConfigOf(resolve2()),
    exportDir: () => resolveExportDir(resolve2().exportDir),
    hostContext
  });
  const tools = [
    dschatStatusTool(engine, store, listWorkspaces),
    dschatSendTool(engine),
    dschatRecoverTool(engine),
    dschatImportTool(store),
    dschatTransferTool(ctx, store, distillConfigOf(resolve2()))
  ];
  let disposeSection;
  let disposeRoutes;
  let disposeTools;
  const sync = () => {
    if (disposeSection !== void 0) {
      disposeSection();
      disposeSection = void 0;
    }
    if (disposeRoutes !== void 0) {
      disposeRoutes();
      disposeRoutes = void 0;
    }
    if (disposeTools !== void 0) {
      disposeTools();
      disposeTools = void 0;
    }
    const value = resolve2();
    if (!value.enabled) return;
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: "plugin:dsh-dschat",
        order: SECTION_ORDER,
        text: DSCHAT_GUIDANCE
      });
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map((route) => ctx.webServer.register(route));
        return () => {
          for (const dispose of disposers) dispose();
        };
      },
      "dsh-dschat: routes"
    );
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map((tool) => ctx.tools.register(tool));
        return () => {
          for (const dispose of disposers) dispose();
        };
      },
      "dsh-dschat: tools"
    );
  };
  sync();
}
export {
  Config,
  DSCHAT_GUIDANCE,
  apply,
  inject,
  name
};
