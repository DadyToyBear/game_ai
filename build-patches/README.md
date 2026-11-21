# Redot 26.3 RC2 build patch

`fix_tinyexr.py` targets upstream commit `80d31f765b0ead5551c277704e52bb51c515db1f`. It fixes WebAssembly's C++20 `std::span` narrowing in TinyEXR. It also checks that the input length fits `size_t` and `Vector<uint8_t>::Size`, and checks the resize error before reading data. No compiler warning is suppressed. The script fails if the expected source does not match, rather than silently patching a different version.

Apply to a clean checkout of that commit **before** running SCons:

```bash
python3 build-patches/fix_tinyexr.py engine
```

The current GitHub Actions workflow must explicitly run this command. The patch was checked against the exact source file, but a complete Web build is required to verify the fix and discover any further errors.
