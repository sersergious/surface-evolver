/*************************************************************
*  This file is part of the Surface Evolver source code.     *
*  Programmer:  Ken Brakke, brakke@susqu.edu                 *
*************************************************************/

/**************************************************************
*  File: include.h                                            *
*  Purpose: master include file for all Evolver source files. *
**************************************************************/


#ifdef PTHREADS
#define THREADS
#define PARALLEL_MACHINE
#define SHARED_MEMORY
#endif

/* for tracking memory usage */
#ifdef MEMSTRINGS
#define mycalloc(num,size)  kb_calloc(num,size,__FILE__,__LINE__)
#define temp_calloc(num,size)  kb_temp_calloc(num,size,__FILE__,__LINE__)
#define temp_realloc(oldptr,size)  kb_temp_realloc(oldptr,size,__FILE__,__LINE__)
#define kb_realloc(ptr,new) KB_realloc(ptr,new,__FILE__,__LINE__)
#define dmatrix(a,b,c,d) kb_dmatrix(a,b,c,d,__FILE__,__LINE__)
#define dmatrix3(a,b,c) kb_dmatrix3(a,b,c,__FILE__,__LINE__)
#define dmatrix4(a,b,c,d) kb_dmatrix4(a,b,c,d,__FILE__,__LINE__)
#define temp_dmatrix(a,b,c,d) kb_temp_dmatrix(a,b,c,d,__FILE__,__LINE__)
#define temp_dmatrix3(a,b,c) kb_temp_dmatrix3(a,b,c,__FILE__,__LINE__)
#define temp_dmatrix4(a,b,c,d) kb_temp_dmatrix4(a,b,c,d,__FILE__,__LINE__)
#define my_list_calloc(a,b,c) list_calloc(a,b,c,__FILE__,__LINE__)
#define my_list_realloc(a,b,c) list_realloc(a,b,c,__FILE__,__LINE__)
#else
#define mycalloc(num,size)  kb_calloc(num,size)
#define temp_calloc(num,size)  kb_temp_calloc(num,size)
#define temp_realloc(oldptr,size)  kb_temp_realloc(oldptr,size)
#define kb_realloc(ptr,new) KB_realloc(ptr,new)
#define dmatrix(a,b,c,d) kb_dmatrix(a,b,c,d)
#define dmatrix3(a,b,c) kb_dmatrix3(a,b,c)
#define dmatrix4(a,b,c,d) kb_dmatrix4(a,b,c,d)
#define temp_dmatrix(a,b,c,d) kb_temp_dmatrix(a,b,c,d)
#define temp_dmatrix3(a,b,c) kb_temp_dmatrix3(a,b,c)
#define temp_dmatrix4(a,b,c,d) kb_temp_dmatrix4(a,b,c,d)
#define my_list_calloc(a,b,c) list_calloc(a,b,c)
#define my_list_realloc(a,b,c) list_realloc(a,b,c)
#endif
#include <time.h>

/* speed up to replace rep stosd; assumes size multiple of int */
#ifdef KBMEMSET
#define memset0(dest,count) { int im; int *pm = (int*)(dest) ;  \
    for ( im = (count)/sizeof(int) ; im > 0 ; im-- ) *(pm++) = 0; }
#else
#define memset0(dest,count) memset(dest,0,count)
#endif

/* Precision */
extern int DWIDTH;
extern int DPREC;
#ifdef FLOAT128
// For gcc __float128 with libquadmath
#include <quadmath.h>
#define REAL  __float128
#define DOT    dot
//#define DWIDTH 37
//#define DPREC  34
#elif defined(LONGDOUBLE)
#define REAL  long double
#define DOT    dot
//#define DWIDTH ((sizeof(REAL)==16) ? 35 : 22)
//#define DPREC ((sizeof(REAL)==16) ? 32 : 19)
#else
#ifdef FLOAT
#define REAL float
#define DOT  dotf
#define v3d  v3f
#define v2d  v2f
#else
#define REAL  double
#define DOT    dot
#endif
#endif

#ifdef USE_READLINE //CSL
#define MOREPROMPT (char *)1
#define CONTPROMPT (char *)2
#endif

#ifdef MKL
#include "mkl_types.h"
#endif

/* Linux */
#include <ctype.h>
#include <fcntl.h>
#include <errno.h>
#include <math.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <memory.h>
#include <setjmp.h>
#include <signal.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/times.h>
#include <sys/time.h>
#include <sys/param.h>
#include <sys/sysinfo.h>
#include <glob.h>
#define is_finite(x) (((x)>(-1e300))&&((x)<1e300))
/* MAXALLOC is maximum size allocable by calloc() */
#define    MAXALLOC 0x7FFFFFFFL
/* PATHCHAR is name-separating character in paths */
#define PATHCHAR '/'
/* ENVPATHCHAR is the path separating character in environment strings */
#define ENVPATHCHAR ":"
#define FCAST (int(*)(const void*,const void *))

/* m_get_myid() returns 0 on non-SGI single-process systems */
#define m_get_myid() 0

/* huge is a Borland/old-compiler concept; define as empty on Linux */
#ifndef huge
#define huge
#endif

#ifndef FCAST
#define FCAST
#endif

typedef int DY_OFFSET ;



/* Some don't have these manifest constants in math.h (namely, Microsoft) */
#ifndef M_LN2
#define M_E                 2.71828182845904523536
#define M_PI                3.14159265358979323846
#define M_LN2              0.693147180559945309417
#endif

#ifdef FLOAT128
#undef  M_E
#define M_E    M_Eq
#undef  M_PI
#define M_PI   M_PIq
#undef  M_LN2
#define M_LN2  M_LN2q

#elif defined(LONGDOUBLE)
#undef  M_E
#define M_E                 2.7182818284590452353602874713527L
#undef  M_PI
#define M_PI                3.1415926535897932384626433832795L
#undef  M_LN2
#define M_LN2              0.693147180559945309417L
#endif

#ifndef DBL_EPSILON
#define DBL_EPSILON      2.2204460492503131e-16
#endif

/* can undefine or redefine these if your system has decent string functions */
#ifndef stricmp
#define stricmp(s1,s2)  kb_stricmp((s1),(s2))
#define strnicmp(s1,s2,n)  kb_strnicmp((s1),(s2),(n))
#endif
#ifndef strstr
#define strstr(s1,s2) kb_strstr((s1),(s2))
#endif
#ifndef strupr
#define strupr(a) kb_strupr(a)
#endif

/* Since tolower and toupper don't always check case before converting */
#undef tolower
#undef toupper
#define tolower(c)    (isupper(c) ? ((c)-'A'+'a') : c)
#define toupper(c)    (islower(c) ? ((c)-'a'+'A') : c)

#ifndef MAXDOUBLE
#define MAXDOUBLE 1.0e38
#endif

#ifdef ENABLE_DLL
#include <dlfcn.h>
#endif

#ifdef USE_READLINE
#include <readline/readline.h>
#include <readline/history.h>
#endif


#ifdef PTHREADS
#include <pthread.h>
#endif

/* Evolver header files */
#ifdef __cplusplus
extern "C" {
#endif
#include "model.h"
#include "storage.h"
#include "skeleton.h"
#include "quantity.h"
#include "extern.h"
#include "express.h"
#include "node_names.h"
#include "web.h"
#include "lex.h"
#ifdef __cplusplus
}
#endif
#include "proto.h"

/* in case of non-parallel machines */
#ifndef M_LOCK
#define M_LOCK(addr)
#define M_UNLOCK(addr)
#endif

#ifndef MAXINT
#define MAXINT (~(1<<(8*sizeof(int)-1)))
#endif

#ifndef FPRESET
#define FPRESET
#endif

#ifdef FLOAT128
/* have to do these after math.h */
#define sin sinq
#define cos cosq
#define tan tanq
#define asin asinq
#define acos acosq
#define atan atanq
#define sinh sinhq
#define cosh coshq
#define tanh tanhq
#define asinh asinhq
#define acosh acoshq
#define atanh atanhq
#define exp expq
#define log logq
#define pow powq
#define sqrt sqrtq
#define ceil ceilq
#define fabs fabsq
#define floor floorq
#define fmod fmodq
#define modf modfq
#define atof(a) strtoflt128(a,NULL)

#elif defined(LONGDOUBLE) && !defined(NOLONGMATHFUNC)
/* have to do these after math.h */
#define sin sinl
#define cos cosl
#define tan tanl
#define asin asinl
#define acos acosl
#define atan atanl
#define sinh sinhl
#define cosh coshl
#define tanh tanhl
#define asinh asinhl
#define acosh acoshl
#define atanh atanhl
#define exp expl
#define log logl
#define pow powl
#define sqrt sqrtl
#define ceil ceill
#define fabs fabsl
#define floor floorl
#define fmod fmodl
#define modf modfl
long double strtold(const char *, char **);
#define atof(a) strtold(a,NULL)
#endif

#ifdef INLINE
#include "inline.h"
#endif
/* for things we really want to be plain double */
#ifndef DOUBLE
#define DOUBLE double
#endif


