// The Android JVM tests compile the plugin's Kotlin the way an app on cordova-android builds it, so the Gradle, the Android Gradle
// plugin and the Kotlin are the ones that cordova-android release ships with, not the newest. This reads them out of the installed
// cordova-android, so bumping that dependency without moving test/android fails here, and a tool bump that is not a cordova-android
// bump never gets in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('test/android builds with the Gradle, the Android Gradle plugin and the Kotlin of the cordova-android it tests against', () => {
  const shipped = JSON.parse(read('node_modules/cordova-android/framework/cdv-gradle-config-defaults.json'));
  const agp = /'com\.android\.library' version '([\d.]+)'/.exec(read('test/android/build.gradle'))?.[1];
  const kotlin = /'org\.jetbrains\.kotlin\.android' version '([\d.]+)'/.exec(read('test/android/build.gradle'))?.[1];
  const gradle = /gradle-([\d.]+)-bin\.zip/.exec(read('test/android/gradle/wrapper/gradle-wrapper.properties'))?.[1];
  assert.equal(agp, shipped.AGP_VERSION, 'Android Gradle plugin: test/android against cordova-android');
  assert.equal(kotlin, shipped.KOTLIN_VERSION, 'Kotlin: test/android against cordova-android');
  assert.equal(gradle, shipped.GRADLE_VERSION, 'Gradle: test/android against cordova-android');
});
