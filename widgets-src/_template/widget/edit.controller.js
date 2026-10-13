/* Copyright start
   MIT License
   Copyright (c) 2026 Your Team
   Copyright end */
"use strict";
// EDIT controller: the config editor. The SOAR shell opens it as a $uibModal
// when a widget is added or edited, and passes `config` and
// `$uibModalInstance` as controller LOCALS. They are not injector services
// ($injector.get throws for both), so they must be listed in $inject; Save
// closes the modal with the config. See KNOWLEDGEBASE.md 5.2.
(function () {
  angular
    .module("cybersponse")
    .controller("editMyWidget100DevCtrl", editMyWidget100DevCtrl);

  editMyWidget100DevCtrl.$inject = ["$scope", "$uibModalInstance", "config"];

  function editMyWidget100DevCtrl($scope, $uibModalInstance, config) {
    var defaults = { title: "Hello" };
    $scope.config = angular.extend({}, defaults, config || {});

    $scope.save = function () { $uibModalInstance.close($scope.config); };
    $scope.cancel = function () { $uibModalInstance.dismiss("cancel"); };
  }
})();
