import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The app's own version, beside the mod's: see version.properties.
val version = Properties().apply { rootProject.file("version.properties").inputStream().use { load(it) } }

// Release signing, read from a file kept out of version control (CI writes it
// from secrets). A checkout without it still builds; the release APK just comes
// out unsigned.
val signing = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "ru.combogame.yamodsync"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.combogame.yamodsync"
        minSdk = 26
        targetSdk = 37
        versionCode = version.getProperty("versionCode").toInt()
        versionName = version.getProperty("versionName")

        // Only the ABIs the Rust core is built for. Without this the APK would
        // claim x86 support and then fail at System.loadLibrary.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    signingConfigs {
        if (signing.containsKey("storeFile")) {
            create("release") {
                storeFile = rootProject.file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // R8 has no rules for the JNI entry points, and a broken release is
            // worse than a larger one.
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    // The Rust core, built by cargo-ndk straight into this layout.
    sourceSets["main"].jniLibs.directories.add("../../crates/android/jniLibs")

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.service)
    implementation(libs.core.ktx)
    implementation(libs.media3.session)
    implementation(libs.media3.common)
    implementation(libs.datastore.preferences)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.palette)

    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
