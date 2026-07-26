allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
// Some plugins (flutter_ringtone_player) still declare an older compileSdk than
// their AndroidX dependencies require. Pin every Android module to the same
// modern SDK so AAR metadata checks pass. Must run before evaluationDependsOn
// below, which forces subprojects to evaluate.
subprojects {
    afterEvaluate {
        extensions.findByType<com.android.build.gradle.BaseExtension>()?.apply {
            val current = compileSdkVersion?.substringAfter("android-")?.toIntOrNull() ?: 0
            if (current < 36) compileSdkVersion(36)
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
