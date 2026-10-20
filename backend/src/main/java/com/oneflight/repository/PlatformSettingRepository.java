package com.oneflight.repository;

import com.oneflight.domain.PlatformSetting;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PlatformSettingRepository extends JpaRepository<PlatformSetting, String> {}
