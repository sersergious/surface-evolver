# Makefile for Surface Evolver
SHELL= /bin/sh

# NOTE: -DOOGL should be specified in CFLAGS if you want Evolver to
# be able to use geomview.  And -DOOGL is harmless in any case. 

# NOTE: You can use the readline input editing system (if your system has it)
# by adding -DUSE_READLINE to CFLAGS and  -lreadline -lcurses to GRAPHLIB.
# But beware; readline may be incompatible with using geomview.
# Also, the readline code was contributed by a user for version 2.30,
# and may be incompatible with readline libraries on some systems (Mac,
# for instance).

CC= gcc -O3 

#---------------------Start of system choices---------------------------------

# Remove #'s from following 3 lines for generic Unix without builtin graphics.
# Add -DOOGL to CFLAGS if you are using geomview.
#CFLAGS= -DGENERIC
#GRAPH= graphics/nulgraph.o 
#GRAPHLIB= 

#---- Generic Unix -----------------------------------------------------------

# Remove #'s from following 3 lines for generic Unix with X-windows. 
# Add -DOOGL to CFLAGS if you are using geomview.
# You might have to add something like -I/usr/X11R6/include to CFLAGS if 
# there is a problem finding Xlib.h while compiling xgraph.c, and add
# -L/usr/X11R6/lib to GRAPHLIB.
CFLAGS= -DGENERIC
GRAPH= graphics/xgraph.o 
GRAPHLIB= -lX11 
# Use nulgraph for headless build (e.g. macOS without X11): GRAPH= graphics/nulgraph.o GRAPHLIB=
#some places might have -lX11-mit

#-------------------End of system-specific options----------------------------

# Include path for modularized codebase (src/ + subdirs for shared headers)
CFLAGS += -I. -Icore

# VPATH for source files in subdirectories
VPATH = surface:graphics:core

OBJ= surface/calcforc.o  core/variable.o surface/trirevis.o  core/stringl.o core/stringq.o surface/model.o\
	 surface/fixvol.o core/query.o surface/matrix.o graphics/grapher.o graphics/painter.o surface/filml.o surface/filmq.o\
	 surface/torvol.o core/lexinit.o graphics/graphgen.o core/modify.o core/userio.o surface/boundary.o\
         surface/curtest.o graphics/display.o core/yexparse.o core/lexyy.o core/ytab.o surface/hessian.o\
	 core/evaltree.o surface/cnstrnt.o surface/verpopst.o surface/popfilm.o core/machine.o surface/veravg.o \
	 graphics/pixgraph.o core/tmain.o  surface/tordup.o surface/wulff.o core/help.o graphics/psgraph.o core/check.o  \
	 core/utility.o surface/skeleton.o  surface/storage.o core/dump.o surface/iterate.o graphics/filgraph.o graphics/zoom.o\
         graphics/softimag.o graphics/mvgraph.o  surface/diffuse.o surface/sqcurve.o surface/klein.o\
	 core/command.o surface/hidim.o surface/simplex.o surface/metric.o surface/torus.o surface/quotient.o surface/alice.o\
	 core/sdrv.o core/odrv.o core/userfunc.o surface/kusner.o  surface/simequi2.o\
	 graphics/geomgraph.o core/symtable.o core/exprint.o core/quantity.o surface/meanint.o surface/mindeg.o\
	 surface/dodecGroup.o core/registry.o surface/khyp.o surface/gauss.o surface/knot1.o core/eval_all.o\
	 core/lexinit2.o core/evalmore.o surface/knot2.o surface/knot3.o surface/teix.o surface/sqcurve2.o\
	 surface/hessian2.o surface/hessian3.o surface/method1.o surface/method2.o surface/method3.o  surface/bk.o\
	 surface/method4.o surface/method5.o core/eval_sec.o surface/sqcurve3.o surface/metis.o surface/lagrange.o


evolver: makemark  $(OBJ)  $(GRAPH)
	$(CC) $(CFLAGS)  $(OBJ) $(GRAPH) $(GRAPHLIB) -o evolver -lm   

# This is to get global dependencies on the main header files.
makemark: skeleton.h storage.h model.h web.h
	if [[ -z "$(GRAPH)" ]] ; then (echo "ERROR: You need to uncomment your system's lines in Makefile.") ; fi
	rm -f surface/*.o graphics/*.o core/*.o *.o 2>/dev/null || true
	touch makemark

clean:
	rm -f surface/*.o graphics/*.o core/*.o *.o evolver makemark 2>/dev/null || true

.c.o:
	$(CC) $(CFLAGS) -c $< -o $@
 

# lexyy.c and ytab.c should only be remade when interface
# language is changed, which users shouldn't be touching.
#lexyy.c: datafile.lex express.h ytab.c lex.h
#	lex datafile.lex
#	sed '/#ident/d' <lex.yy.c >t.c
#	sed '/int \* p, int m/s/(int \* p, int m)/(p,m) int *p,m;/' <t.c >lexyy.c
#	rm lex.yy.c

#ytab.c:  command.yac  express.h
#	yacc -d command.yac
#	sed '/#ident/d' <y.tab.c >tmp.c
#	sed '/malloc()/d' <tmp.c >ytab.c
#	rm tmp.c
#	cp y.tab.h ytab.h	
#	rm y.tab.c y.tab.h

ytab.h: ytab.c 

core/lexinit.o: lex.h core/lexinit.c express.h core/ytab.h

core/query.o: lex.h core/ytab.h core/query.c

core/evaltree.o: core/evaltree.c lex.h core/ytab.h express.h

core/eval_all.o: core/eval_all.c lex.h core/ytab.h express.h

core/eval_sec.o: core/eval_all.c lex.h core/ytab.h express.h

core/yexparse.o: core/yexparse.c lex.h core/ytab.h express.h

core/exprint.o: core/exprint.c lex.h core/ytab.h express.h

core/tmain.o: core/tmain.c include.h


