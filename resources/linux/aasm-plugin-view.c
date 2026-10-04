/*
 * Show one server its own ArkApi/Plugins folder and its own ini folder.
 *
 * AsaApi loads plugins from the directory next to the shared loader, and ARK
 * reads Game.ini from the same shared tree. This runs the server inside a
 * private mount namespace where those directories are the instance's own folders.
 * The mount does not propagate to the host or to any other server.
 *
 * Installed as /usr/local/bin/aasm-plugin-view with cap_sys_admin. It drops
 * that capability before executing the server.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/capability.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <limits.h>

static const char *PLUGIN_SUFFIX = "/ShooterGame/Binaries/Win64/ArkApi/Plugins";
static const char *INSTANCE_CONFIG_SUFFIX = "/Config/WindowsServer";
static const char *SHARED_CONFIG_SUFFIX = "/ShooterGame/Saved/Config/WindowsServer";
#define MAX_BINDS 8

static int ends_with(const char *value, const char *suffix) {
  size_t value_len = strlen(value);
  size_t suffix_len = strlen(suffix);
  if (value_len < suffix_len) return 0;
  return strcmp(value + value_len - suffix_len, suffix) == 0;
}

static int drop_privileges(void) {
  struct __user_cap_header_struct header = { _LINUX_CAPABILITY_VERSION_3, 0 };
  struct __user_cap_data_struct data[2];
  memset(data, 0, sizeof(data));
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  if (syscall(SYS_capset, &header, data) != 0) return -1;
  return 0;
}

static int pair_allowed(const char *source_real, const char *target_real) {
  int plugins = ends_with(source_real, PLUGIN_SUFFIX) && ends_with(target_real, PLUGIN_SUFFIX);
  int config = ends_with(source_real, INSTANCE_CONFIG_SUFFIX) && ends_with(target_real, SHARED_CONFIG_SUFFIX);
  if (!plugins && !config) {
    fprintf(stderr, "refusing a path that is not plugins or server config\n");
    return 0;
  }
  if (!strstr(source_real, "/Saved/Servers/")) {
    fprintf(stderr, "source must belong to one server instance\n");
    return 0;
  }
  if (strstr(target_real, "/Saved/Servers/")) {
    fprintf(stderr, "target must be the shared install\n");
    return 0;
  }
  if (strcmp(source_real, target_real) == 0) {
    fprintf(stderr, "source and target are the same directory\n");
    return 0;
  }
  return 1;
}

int main(int argc, char **argv) {
  char source_real[MAX_BINDS][PATH_MAX];
  char target_real[MAX_BINDS][PATH_MAX];
  int binds = 0;
  int i = 1;

  if (argc >= 5 && strcmp(argv[3], "--") == 0) {
    argv[0] = "--bind";
    i = 0;
  }

  while (i < argc && strcmp(argv[i], "--") != 0) {
    if (strcmp(argv[i], "--bind") != 0 || i + 2 >= argc) {
      fprintf(stderr, "usage: aasm-plugin-view --bind <instance-dir> <shared-dir> [--bind ...] -- <command> [args...]\n");
      return 2;
    }
    if (binds >= MAX_BINDS) {
      fprintf(stderr, "too many binds\n");
      return 2;
    }
    if (!realpath(argv[i + 1], source_real[binds]) || !realpath(argv[i + 2], target_real[binds])) {
      perror("realpath");
      return 1;
    }
    if (!pair_allowed(source_real[binds], target_real[binds])) return 1;
    binds++;
    i += 3;
  }

  if (binds == 0 || i >= argc || strcmp(argv[i], "--") != 0 || i + 1 >= argc) {
    fprintf(stderr, "usage: aasm-plugin-view --bind <instance-dir> <shared-dir> [--bind ...] -- <command> [args...]\n");
    return 2;
  }

  if (unshare(CLONE_NEWNS) != 0) {
    perror("unshare");
    return 1;
  }
  /* Keep these mounts inside the new namespace. A shared propagation would
   * replace the folder for every other server on the host. */
  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) {
    perror("mount private");
    return 1;
  }
  for (int n = 0; n < binds; n++) {
    if (mount(source_real[n], target_real[n], NULL, MS_BIND, NULL) != 0) {
      perror("mount bind");
      return 1;
    }
  }
  if (drop_privileges() != 0) {
    perror("drop privileges");
    return 1;
  }

  execvp(argv[i + 1], argv + i + 1);
  perror("exec");
  return 1;
}
