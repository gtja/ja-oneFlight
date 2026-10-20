package com.oneflight.repository;

import com.oneflight.domain.Consultation;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ConsultationRepository extends JpaRepository<Consultation, String> {}
