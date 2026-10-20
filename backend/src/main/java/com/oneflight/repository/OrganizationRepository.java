package com.oneflight.repository;

import com.oneflight.domain.Organization;

import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganizationRepository extends JpaRepository<Organization, String> {}
