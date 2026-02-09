# Surface Evolver Source Modularization

The source code has been reorganized into three main modules:

## Directory Structure

```
src/
├── core/          # Command interpreter, I/O, shell
├── graphics/      # Display and rendering backends
├── surface/       # Surface geometry, math, physics
└── *.h            # Shared headers (include.h, proto.h, model.h, etc.)
```

## Module Contents

### `surface/` – Surface geometry and mathematics
- **Force/energy**: `calcforc.c`, `gauss.c`, `hessian*.c`, `meanint.c`
- **Models**: `filml.c`, `filmq.c`, `model.c`, `lagrange.c`
- **Boundaries**: `boundary.c`, `cnstrnt.c`, `fixvol.c`
- **Geometry**: `metric.c`, `simplex.c`, `matrix.c`, `quotient.c`
- **Topology**: `torus.c`, `torvol.c`, `tordup.c`, `hidim.c`
- **Optimization**: `iterate.c`, `method1.c`–`method5.c`, `bk.c`, `metis.c`, `mindeg.c`
- **Curves**: `sqcurve*.c`, `kusner.c`, `klein.c`, `khyp.c`, `knot*.c`
- **Storage**: `storage.c`, `skeleton.c`, `trirevis.c`
- **Other**: `veravg.c`, `verpopst.c`, `popfilm.c`, `diffuse.c`, `dodecGroup.c`, `symmetry.c`, `simequi2.c`, `teix.c`, `alice.c`, `curtest.c`, `wulff.c`

### `graphics/` – Display and rendering
- **Backends**: `xgraph.c` (X11), `glutgraph.c` (OpenGL), `nulgraph.c` (headless), `oglgraph.c`, `gnugraph.c`, `psgraph.c`, `pixgraph.c`
- **Core**: `painter.c`, `display.c`, `grapher.c`, `graphgen.c`
- **Export**: `filgraph.c`, `geomgraph.c`, `mvgraph.c`, `softimag.c`
- **View**: `zoom.c`

### `core/` – Shell and command processing
- **Main**: `tmain.c`, `command.c`, `machine.c`
- **Parsing**: `lexinit.c`, `lexinit2.c`, `lexyy.c`, `ytab.c`, `yexparse.c`
- **Evaluation**: `evaltree.c`, `eval_all.c`, `eval_sec.c`, `evalmore.c`, `exprint.c`
- **Commands**: `query.c`, `modify.c`, `check.c`, `dump.c`
- **User**: `userio.c`, `userfunc.c`, `variable.c`, `help.c`
- **Other**: `quantity.c`, `registry.c`, `symtable.c`, `utility.c`, `stringl.c`, `stringq.c`, `odrv.c`, `sdrv.c`, `alloca.c`, `tokname.c`

## Build Configuration

- **Include paths**: `-I. -Icore` so all modules can find shared headers.
- **VPATH**: `surface:graphics:core` so make can locate sources in subdirs.
- **Graphics backend**: Choose one of `graphics/xgraph.o`, `graphics/glutgraph.o`, or `graphics/nulgraph.o` in the Makefile.

## Headless Build (e.g. macOS without X11)

In the Makefile, use:
```
GRAPH= graphics/nulgraph.o 
GRAPHLIB= 
```
